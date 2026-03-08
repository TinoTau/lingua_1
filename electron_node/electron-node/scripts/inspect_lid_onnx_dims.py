"""
检查 LID ONNX 模型各层/常量中与 mel 维数相关的维度，并精确定位 60 by 98 的修复点。
用法: python scripts/inspect_lid_onnx_dims.py [model.onnx 路径，默认 models/model.onnx]
"""
import sys
import os

def _shape_of_initializer(init):
    return list(init.dims)

def _shape_of_constant_node(onnx_model, node):
    import onnx
    for attr in node.attribute:
        if attr.name == "value":
            arr = onnx.numpy_helper.to_array(attr.t)
            return list(arr.shape)
    return None

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "models", "model.onnx")
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        print("File not found:", path)
        sys.exit(1)

    import onnx
    m = onnx.load(path)

    init_by_name = {init.name: init for init in m.graph.initializer}
    graph_input_names = {inp.name for inp in m.graph.input}
    node_output_to_node = {}
    for n in m.graph.node:
        for out in n.output:
            node_output_to_node[out] = n

    print("=" * 60)
    print("LID ONNX 维度检查:", path)
    print("=" * 60)

    # 1. 图输入
    for inp in m.graph.input:
        dims = [d.dim_value if d.dim_value else ("dynamic" if d.dim_param else "?") for d in inp.type.tensor_type.shape.dim]
        print("\n[INPUT]", inp.name, "shape:", dims)

    # 2. 所有 initializer：60/98 相关（含 1D，如 running_mean (98,)）
    dim_60 = []
    dim_98 = []
    for init in m.graph.initializer:
        d = list(init.dims)
        if len(d) == 1:
            if d[0] == 60:
                dim_60.append((init.name, d, "1D"))
            elif d[0] == 98:
                dim_98.append((init.name, d, "1D"))
        elif len(d) >= 2:
            second = d[1]
            if second == 60:
                dim_60.append((init.name, d, "2D+"))
            elif second == 98:
                dim_98.append((init.name, d, "2D+"))

    print("\n[INITIALIZERS] 含 60 维:")
    for name, d, kind in dim_60:
        print("  ", name, d, kind)
    print("\n[INITIALIZERS] 含 98 维:")
    for name, d, kind in dim_98:
        print("  ", name, d, kind)

    # 3. mean_var_norm 相关 Sub：两个输入的精确来源与形状
    print("\n[MEAN_VAR_NORM / Sub 节点 — 精确输入来源]")
    sub_node = None
    sub_input_sources = []
    for n in m.graph.node:
        if n.op_type == "Sub" and "mean_var_norm" in n.name:
            sub_node = n
            print("  节点名:", n.name, "  输出:", n.output)
            for i, name in enumerate(n.input):
                src = None
                shape = None
                if name in graph_input_names:
                    src = "graph_input"
                    for inp in m.graph.input:
                        if inp.name == name:
                            shape = [d.dim_value if d.dim_value else ("dynamic" if d.dim_param else "?") for d in inp.type.tensor_type.shape.dim]
                            break
                elif name in init_by_name:
                    src = "initializer"
                    shape = _shape_of_initializer(init_by_name[name])
                elif name in node_output_to_node:
                    prev = node_output_to_node[name]
                    if prev.op_type == "Constant":
                        src = "Constant_node"
                        shape = _shape_of_constant_node(m, prev)
                    else:
                        src = "node:" + prev.op_type
                else:
                    src = "unknown"
                sub_input_sources.append((name, src, shape))
                print("    输入[%d] %s -> %s shape=%s" % (i, name, src, shape))
            break

    # 4. 100% 可控修复点
    print("\n" + "=" * 60)
    print("[修复点 — 100% 可控目标]")
    print("=" * 60)
    fix_targets = []
    if sub_input_sources:
        for name, src, shape in sub_input_sources:
            if src == "initializer" and shape is not None:
                if 98 in shape or (len(shape) == 1 and shape[0] == 98):
                    fix_targets.append(("initializer", name, shape, "截为 60 维（同维处 98->60）"))
            if src == "Constant_node" and shape is not None:
                if 98 in shape or (len(shape) == 1 and shape[0] == 98):
                    fix_targets.append(("Constant_node", name, shape, "该 Constant 的 value 截为 60 维"))

    if fix_targets:
        for kind, name, shape, action in fix_targets:
            print("  类型: %s" % kind)
            print("  名称: %s" % name)
            print("  当前形状: %s" % shape)
            print("  修复动作: %s" % action)
            print()
        print("  图手术只需对以上所列项做 98->60 截断，无需改拓扑。")
    else:
        print("  未在 Sub 的输入中检测到 98 维的 initializer/Constant。")
        print("  若仍报 60 by 98，可能 98 维在其它节点或中间形状中，需进一步查该 Sub 上游数据路径。")
    print("=" * 60)

if __name__ == "__main__":
    main()
