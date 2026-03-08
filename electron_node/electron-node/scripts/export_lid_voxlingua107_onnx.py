"""
一次性脚本：将 SpeechBrain VoxLingua107 导出为 ONNX，供节点端 onnxruntime-node 使用。
运行：pip install speechbrain torch onnx；python export_lid_voxlingua107_onnx.py [输出目录]
输出：<out_dir>/model.onnx、<out_dir>/labels.txt（107 行，与 logits 下标对应）
"""
import argparse
import os
import sys

# Windows 下强制 COPY，避免 SpeechBrain 内部 symlink 导致 OSError 1314
def _patch_speechbrain_copy():
    import speechbrain.utils.fetching as sb_fetch
    _orig = sb_fetch.link_with_strategy
    def _link_copy(fetched_file, destination, local_strategy):
        return _orig(fetched_file, destination, sb_fetch.LocalStrategy.COPY)
    sb_fetch.link_with_strategy = _link_copy


def main():
    parser = argparse.ArgumentParser(description="Export VoxLingua107 to ONNX")
    parser.add_argument("out_dir", nargs="?", default="lid_voxlingua107_onnx", help="Output directory")
    args = parser.parse_args()
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    try:
        import torch
    except ImportError:
        print("Need torch: pip install torch", file=sys.stderr)
        sys.exit(1)
    try:
        _patch_speechbrain_copy()
        from speechbrain.inference.classifiers import EncoderClassifier
    except ImportError:
        print("Need speechbrain: pip install speechbrain", file=sys.stderr)
        sys.exit(1)

    sb_cache = os.path.join(out_dir, "sb_cache")
    os.makedirs(sb_cache, exist_ok=True)
    # Windows 下 SpeechBrain 默认 symlink 会失败，先用 huggingface_hub 复制下载
    try:
        from huggingface_hub import snapshot_download
        print("Downloading speechbrain/lang-id-voxlingua107-ecapa (no symlinks) ...")
        local_dir = snapshot_download(
            repo_id="speechbrain/lang-id-voxlingua107-ecapa",
            local_dir=sb_cache,
            local_dir_use_symlinks=False,
        )
        source = local_dir
    except Exception as e:
        print("huggingface_hub download failed, using SpeechBrain fetch:", e)
        source = "speechbrain/lang-id-voxlingua107-ecapa"

    print("Loading model ...")
    model = EncoderClassifier.from_hparams(
        source=source,
        savedir=sb_cache,
    )
    model.eval()

    # 107 语种顺序（与 HuggingFace label_encoder.txt 一致，index 0..106）
    LABELS = [
        "ab", "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "ceb",
        "cs", "cy", "da", "de", "el", "en", "eo", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl",
        "gn", "gu", "gv", "ha", "haw", "hi", "hr", "ht", "hu", "hy", "ia", "id", "is", "it", "iw",
        "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi",
        "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps",
        "pt", "ro", "ru", "sa", "sco", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv",
        "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "war", "yi",
        "yo", "zh",
    ]
    assert len(LABELS) == 107

    labels_path = os.path.join(out_dir, "labels.txt")
    with open(labels_path, "w", encoding="utf-8") as f:
        for code in LABELS:
            f.write(code + "\n")
    print("Wrote", labels_path)

    # 整图含 STFT 时 ONNX 导出会因 complex 类型失败，改为只导出「Fbank 特征 -> logits」
    # 预训练图内 mean_var_norm 的 mean 与 embedding 首层均为 60 维，须用 60-mel 导出方可避免 60 by 98
    with torch.no_grad():
        dummy_wav = torch.randn(1, 16000)
        feats = model.mods.compute_features(dummy_wav)
    _n, T = feats.shape[1], feats.shape[2]
    n_mels = 60  # 与图内 mean_var_norm、embedding 首层一致；节点端须配置 n_mels=60
    print("compute_features raw shape: [1, {}, {}]; exporting with n_mels={}".format(_n, T, n_mels))

    class FeatsToLogits(torch.nn.Module):
        def __init__(self, encoder_classifier):
            super().__init__()
            self.m = encoder_classifier

        def forward(self, feats: torch.Tensor) -> torch.Tensor:
            wav_lens = torch.ones(feats.shape[0], device=feats.device, dtype=feats.dtype)
            n = self.m.mods.mean_var_norm(feats, wav_lens)
            emb = self.m.mods.embedding_model(n, wav_lens)
            logits = self.m.mods.classifier(emb).squeeze(1)
            return logits

    feats_to_logits = FeatsToLogits(model)
    feats_to_logits.eval()

    onnx_path = os.path.join(out_dir, "model.onnx")
    print("Exporting ONNX (feats [1, {}, T] -> logits, no STFT) ...".format(n_mels))
    dummy_feats = torch.randn(1, n_mels, T)
    torch.onnx.export(
        feats_to_logits,
        dummy_feats,
        onnx_path,
        input_names=["feats"],
        output_names=["logits"],
        dynamic_axes={"feats": {0: "batch", 2: "time"}, "logits": {0: "batch"}},
        opset_version=14,
    )

    # 图手术：mean_var_norm/Sub 的 98 维输入（initializer 或 Constant）截为 60，消除 60 by 98
    try:
        import onnx
        from onnx import numpy_helper, helper
        import numpy as np
        model = onnx.load(onnx_path)
        init_by_name = {init.name: init for init in model.graph.initializer}
        node_output_to_node = {}
        for n in model.graph.node:
            for out in n.output:
                node_output_to_node[out] = n

        # 收集所有 mean_var_norm 相关节点的输入名（Sub、Expand 等），凡 98 维常量均截为 60
        mean_var_norm_input_names = set()
        for n in model.graph.node:
            if "mean_var_norm" in n.name:
                mean_var_norm_input_names.update(n.input)

        # 兜底：凡名称含 mean_var_norm 的 initializer/Constant 且形状含 98 也一并修复
        def name_related_to_mean_var_norm(name):
            return name and "mean_var_norm" in name

        def truncate_98_to_60(arr):
            """将形状中为 98 的维截为 60，返回新数组。"""
            arr = np.asarray(arr)
            if 98 not in arr.shape:
                return None
            axis = list(arr.shape).index(98)
            idx = [slice(None)] * arr.ndim
            idx[axis] = slice(0, 60)
            return arr[tuple(idx)].astype(arr.dtype)

        patched = 0

        # 1) 修复 initializer：被 mean_var_norm 任一节点引用或名称含 mean_var_norm，且形状含 98 的，截为 60
        for init in model.graph.initializer:
            if init.name not in mean_var_norm_input_names and not name_related_to_mean_var_norm(init.name):
                continue
            d = list(init.dims)
            if 98 not in d:
                continue
            t = numpy_helper.to_array(init)
            t60 = truncate_98_to_60(t)
            if t60 is not None:
                init.CopyFrom(numpy_helper.from_array(t60, init.name))
                patched += 1
                print("Patched initializer", init.name, list(t.shape), "->", list(t60.shape))

        # 2) 修复 Constant 节点：输出被 mean_var_norm 任一节点引用或名称含 mean_var_norm，且 value 形状含 98 的，截为 60
        for node in model.graph.node:
            if node.op_type != "Constant":
                continue
            out_name = node.output[0] if node.output else ""
            if out_name not in mean_var_norm_input_names and not name_related_to_mean_var_norm(out_name):
                continue
            for attr in node.attribute:
                if attr.name == "value":
                    t = numpy_helper.to_array(attr.t)
                    if 98 not in t.shape:
                        break
                    t60 = truncate_98_to_60(t)
                    if t60 is not None:
                        attr.CopyFrom(helper.make_attribute("value", numpy_helper.from_array(t60)))
                        patched += 1
                        print("Patched Constant", node.output[0], list(t.shape), "->", list(t60.shape))
                    break

        # 3) 数据路径修复：入口处插入 Slice(axis=1, end=60)，所有对 feats 的引用改为 Slice 输出，整图统一 60 维
        from onnx import TensorProto
        FEATS_INPUT = "feats"
        FEATS_SLICED = "feats_sliced_60"
        c_starts = helper.make_tensor("slice_feats_starts_60", TensorProto.INT64, [1], [0])
        c_ends = helper.make_tensor("slice_feats_ends_60", TensorProto.INT64, [1], [60])
        c_axes = helper.make_tensor("slice_feats_axes_1", TensorProto.INT64, [1], [1])
        slice_feats_node = helper.make_node(
            "Slice",
            inputs=[FEATS_INPUT, "slice_feats_starts_60", "slice_feats_ends_60", "slice_feats_axes_1"],
            outputs=[FEATS_SLICED],
            name="/feats_slice_60",
        )
        model.graph.initializer.append(c_starts)
        model.graph.initializer.append(c_ends)
        model.graph.initializer.append(c_axes)
        for node in model.graph.node:
            for i in range(len(node.input)):
                if node.input[i] == FEATS_INPUT:
                    node.input[i] = FEATS_SLICED
        model.graph.node.insert(0, slice_feats_node)
        # 4) 在 mean_var_norm/Sub 的数据输入前再插 Slice(axis=1, end=60)，防止上游 Gather 等输出 98 维
        node_output_to_node2 = {out: n for n in model.graph.node for out in (n.output or [])}
        for n in model.graph.node:
            if n.op_type != "Sub" or "mean_var_norm" not in n.name:
                continue
            data_inp = None
            for inp in n.input:
                if inp in init_by_name or (node_output_to_node2.get(inp) and node_output_to_node2[inp].op_type == "Constant"):
                    continue
                data_inp = inp
                break
            if not data_inp:
                break
            SLICE_MVN_OUT = "mean_var_norm_data_sliced_60"
            s2 = helper.make_tensor("slice_mvn_s2", TensorProto.INT64, [1], [0])
            e2 = helper.make_tensor("slice_mvn_e2", TensorProto.INT64, [1], [60])
            a2 = helper.make_tensor("slice_mvn_a2", TensorProto.INT64, [1], [1])
            model.graph.initializer.extend([s2, e2, a2])
            slice_mvn = helper.make_node("Slice", [data_inp, "slice_mvn_s2", "slice_mvn_e2", "slice_mvn_a2"], [SLICE_MVN_OUT], name="/mean_var_norm/slice_to_60")
            for i, inp in enumerate(n.input):
                if inp == data_inp:
                    n.input[i] = SLICE_MVN_OUT
                    break
            idx = next((i for i, nd in enumerate(model.graph.node) if nd == n), 0)
            model.graph.node.insert(idx, slice_mvn)
            break
        # 5) Expand 的 shape 输入可能为 [1,98,T]，改为 [1,60,T]：shape_0 + 60 + shape_2
        for n in model.graph.node:
            if n.op_type != "Expand" or "mean_var_norm" not in n.name or len(n.input) < 2:
                continue
            shape_inp = n.input[1]
            out_shape_new = "mean_var_norm_expand_shape_60"
            c0 = helper.make_tensor("mvn_s0", TensorProto.INT64, [1], [0])
            c1 = helper.make_tensor("mvn_s1", TensorProto.INT64, [1], [1])
            c2 = helper.make_tensor("mvn_s2", TensorProto.INT64, [1], [2])
            c3 = helper.make_tensor("mvn_s3", TensorProto.INT64, [1], [3])
            c60 = helper.make_tensor("mvn_c60", TensorProto.INT64, [1], [60])
            for t in (c0, c1, c2, c3, c60):
                if t.name not in [x.name for x in model.graph.initializer]:
                    model.graph.initializer.append(t)
            slice0 = helper.make_node("Slice", [shape_inp, "mvn_s0", "mvn_s1", "mvn_s0"], ["mvn_shape_0"], name="/mean_var_norm/shape_0")
            slice2 = helper.make_node("Slice", [shape_inp, "mvn_s2", "mvn_s3", "mvn_s0"], ["mvn_shape_2"], name="/mean_var_norm/shape_2")
            concat = helper.make_node("Concat", ["mvn_shape_0", "mvn_c60", "mvn_shape_2"], [out_shape_new], name="/mean_var_norm/shape_60", axis=0)
            idx_exp = next((i for i, nd in enumerate(model.graph.node) if nd == n), 0)
            for nd in (concat, slice2, slice0):  # 插入顺序倒序，使执行序为 slice0, slice2, concat, Expand
                model.graph.node.insert(idx_exp, nd)
                idx_exp += 1
            n.input[1] = out_shape_new
            break
        try:
            onnx.shape_inference.infer_shapes(model)
        except Exception:
            pass
        onnx.save(model, onnx_path)
        print("ONNX 图手术：已在输入 feats 后插入 Slice(axis=1, end=60)，并在 mean_var_norm/Sub 数据前插 Slice，整图 60 维。")
        if patched:
            print("ONNX 图手术另修补 %d 处 98->60 常量。" % patched)
    except Exception as e:
        print("ONNX patch (98->60) skipped:", e)

    print("Wrote", onnx_path)

    # 写配置供节点端 Fbank 对齐（n_mels=60 与图内一致）
    config_path = os.path.join(out_dir, "fbank_config.txt")
    with open(config_path, "w", encoding="utf-8") as f:
        f.write("n_mels={}\nsample_rate=16000\nwin_length=400\nhop_length=160\n".format(n_mels))
    print("Wrote", config_path)
    print("Done. 在配置中设置 lid.modelPath 指向", out_dir)


if __name__ == "__main__":
    main()
