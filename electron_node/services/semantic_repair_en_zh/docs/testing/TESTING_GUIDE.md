# 测试指南

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0

---

## 📋 测试层次

```
单元测试 (Unit Tests)
    ↓
集成测试 (Integration Tests)
    ↓
API 功能测试 (API Tests)
    ↓
性能测试 (Performance Tests)
    ↓
端到端测试 (E2E Tests)
```

---

## 🧪 单元测试

### 运行所有单元测试

```bash
cd semantic_repair_en_zh
pytest tests/ -v
```

**预期结果**: 15个测试全部通过

### 测试套件

#### 1. BaseProcessor 测试（5个）

**文件**: `tests/test_base_processor.py`

**测试内容**:
- ✅ 初始化成功
- ✅ 初始化失败
- ✅ 并发初始化（10个并发请求）
- ✅ 重复初始化检测
- ✅ 未初始化调用

**运行**:
```bash
pytest tests/test_base_processor.py -v
```

#### 2. ProcessorWrapper 测试（5个）

**文件**: `tests/test_processor_wrapper.py`

**测试内容**:
- ✅ 成功处理请求
- ✅ 超时处理（返回原文）
- ✅ 错误处理（返回原文）
- ✅ 处理器不存在
- ✅ Request ID 自动生成

**运行**:
```bash
pytest tests/test_processor_wrapper.py -v
```

#### 3. Config 测试（5个）

**文件**: `tests/test_config.py`

**测试内容**:
- ✅ 默认配置
- ✅ 环境变量配置
- ✅ 获取启用的处理器
- ✅ 中文配置结构
- ✅ 英文配置结构

**运行**:
```bash
pytest tests/test_config.py -v
```

### 测试覆盖率

```bash
# 生成覆盖率报告
pytest tests/ --cov=. --cov-report=html

# 查看报告
open htmlcov/index.html  # Mac/Linux
start htmlcov/index.html  # Windows
```

---

## 🔌 API 功能测试

### 手动测试脚本

```bash
# test_api.sh
BASE_URL="http://localhost:5015"

echo "=== 1. 健康检查 ==="
curl $BASE_URL/health | jq .

echo -e "\n=== 2. 中文修复测试 ==="
curl -X POST $BASE_URL/zh/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-zh-001",
    "session_id": "session-001",
    "text_in": "你号，这是一个测试。",
    "quality_score": 0.8
  }' | jq .

echo -e "\n=== 3. 英文修复测试 ==="
curl -X POST $BASE_URL/en/repair \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-en-001",
    "session_id": "session-001",
    "text_in": "Helo, this is a test.",
    "quality_score": 0.75
  }' | jq .

echo -e "\n=== 4. 英文标准化测试 ==="
curl -X POST $BASE_URL/en/normalize \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-norm-001",
    "session_id": "session-001",
    "text_in": "HELLO  WORLD !!!"
  }' | jq .
```

### 自动化测试脚本

```python
# test_api_automated.py
import requests
import json

BASE_URL = "http://localhost:5015"

def test_health():
    """测试健康检查"""
    response = requests.get(f"{BASE_URL}/health")
    assert response.status_code == 200
    data = response.json()
    assert data['status'] in ['healthy', 'degraded']
    print("✓ Health check passed")

def test_zh_repair():
    """测试中文修复"""
    response = requests.post(
        f"{BASE_URL}/zh/repair",
        json={
            "job_id": "test-zh",
            "session_id": "s1",
            "text_in": "你号"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert 'decision' in data
    assert 'text_out' in data
    assert data['processor_name'] == 'zh_repair'
    print(f"✓ ZH repair: {data['text_out']}")

def test_en_repair():
    """测试英文修复"""
    response = requests.post(
        f"{BASE_URL}/en/repair",
        json={
            "job_id": "test-en",
            "session_id": "s1",
            "text_in": "helo"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['processor_name'] == 'en_repair'
    print(f"✓ EN repair: {data['text_out']}")

def test_en_normalize():
    """测试英文标准化"""
    response = requests.post(
        f"{BASE_URL}/en/normalize",
        json={
            "job_id": "test-norm",
            "session_id": "s1",
            "text_in": "HELLO"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['processor_name'] == 'en_normalize'
    print(f"✓ EN normalize: {data['text_out']}")

if __name__ == "__main__":
    try:
        test_health()
        test_zh_repair()
        test_en_repair()
        test_en_normalize()
        print("\n✓ All API tests passed!")
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        exit(1)
```

**运行**:
```bash
python test_api_automated.py
```

---

## ⚡ 性能测试

### 1. 响应时间测试

```bash
# 测试平均响应时间（10次请求）
for i in {1..10}; do
  time curl -s -X POST http://localhost:5015/zh/repair \
    -H "Content-Type: application/json" \
    -d "{\"job_id\":\"perf-$i\",\"session_id\":\"s1\",\"text_in\":\"测试\"}" \
    > /dev/null
done
```

### 2. 并发测试

```bash
# 测试并发请求（10个并发）
seq 10 | xargs -P 10 -I {} curl -s -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d "{\"job_id\":\"conc-{}\",\"session_id\":\"s1\",\"text_in\":\"测试\"}"
```

**预期行为**:
- 请求排队处理（max_concurrency=1）
- 全部请求最终返回
- 无超时或错误

### 3. 压力测试

```python
# stress_test.py
import requests
import time
import statistics
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "http://localhost:5015"

def send_request(i):
    """发送单个请求"""
    start = time.time()
    try:
        response = requests.post(
            f"{BASE_URL}/zh/repair",
            json={
                "job_id": f"stress-{i}",
                "session_id": "s1",
                "text_in": "测试文本"
            },
            timeout=60
        )
        elapsed = (time.time() - start) * 1000
        return {
            'success': response.status_code == 200,
            'time': elapsed
        }
    except Exception as e:
        return {
            'success': False,
            'time': None,
            'error': str(e)
        }

# 发送 100 个请求
print("Sending 100 requests...")
with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(send_request, range(100)))

# 统计结果
success_count = sum(1 for r in results if r['success'])
times = [r['time'] for r in results if r['success'] and r['time']]

print(f"\nResults:")
print(f"  Success: {success_count}/100")
print(f"  Failed: {100 - success_count}/100")

if times:
    print(f"\nResponse Times:")
    print(f"  Mean: {statistics.mean(times):.2f}ms")
    print(f"  Median: {statistics.median(times):.2f}ms")
    print(f"  P95: {sorted(times)[int(len(times)*0.95)]:.2f}ms")
    print(f"  P99: {sorted(times)[int(len(times)*0.99)]:.2f}ms")
```

---

## 🔄 回归测试

### 与旧服务对比测试

**目的**: 验证新服务与旧服务功能等价

**脚本**:
```python
# compare_old_new.py
import requests

# 测试用例
test_cases = [
    {"text": "你号", "lang": "zh"},
    {"text": "helo", "lang": "en"},
    {"text": "HELLO", "lang": "en", "normalize": True}
]

for case in test_cases:
    text = case['text']
    lang = case['lang']
    is_normalize = case.get('normalize', False)
    
    # 旧服务
    if is_normalize:
        old_url = "http://localhost:5012/normalize"
    else:
        old_url = f"http://localhost:{'5013' if lang=='zh' else '5011'}/repair"
    
    old_response = requests.post(old_url, json={
        "job_id": "old-test",
        "session_id": "s1",
        "text_in": text,
        "lang": lang
    })
    
    # 新服务
    if is_normalize:
        new_url = "http://localhost:5015/en/normalize"
    else:
        new_url = f"http://localhost:5015/{lang}/repair"
    
    new_response = requests.post(new_url, json={
        "job_id": "new-test",
        "session_id": "s1",
        "text_in": text
    })
    
    old_result = old_response.json()
    new_result = new_response.json()
    
    print(f"\n[{text}]")
    print(f"  Old: {old_result.get('text_out')}")
    print(f"  New: {new_result.get('text_out')}")
    print(f"  Match: {old_result.get('text_out') == new_result.get('text_out')}")
```

---

## 📊 测试报告模板

### 测试执行报告

```markdown
# 测试报告

**日期**: YYYY-MM-DD
**测试人**: XXX
**版本**: 1.0.0

## 测试环境
- OS: Windows 11
- Python: 3.10
- CUDA: 12.1
- GPU: NVIDIA RTX 4060

## 测试结果

### 单元测试
- 总数: 15
- 通过: 15
- 失败: 0
- 覆盖率: 85%

### API 功能测试
- 中文修复: ✓ 通过
- 英文修复: ✓ 通过
- 英文标准化: ✓ 通过
- 健康检查: ✓ 通过

### 性能测试
- 平均响应时间: 320ms
- P95: 450ms
- P99: 520ms
- GPU 使用率: 90%

### 问题记录
无

## 结论
✓ 所有测试通过，服务可以部署
```

---

## ✅ 测试检查清单

### 部署前测试

- [ ] 单元测试全部通过
- [ ] 语法检查通过
- [ ] API 功能测试通过
- [ ] 健康检查返回 healthy
- [ ] GPU 支持验证（如使用 GPU）

### 性能验证

- [ ] 响应时间 <500ms（GPU 模式）
- [ ] GPU 使用率 >80%（推理时）
- [ ] 内存占用稳定
- [ ] 无内存泄漏

### 稳定性测试

- [ ] 压力测试（100+ 请求）
- [ ] 长时间运行（24小时+）
- [ ] 并发测试
- [ ] 错误恢复测试

---

## 📚 相关文档

- [API 参考](./API_REFERENCE.md) - API 详细说明
- [性能优化](./PERFORMANCE_OPTIMIZATION.md) - 性能调优
- [故障排查](./TROUBLESHOOTING.md) - 问题诊断

---

**更新**: 2026-01-19  
**维护**: 开发团队
