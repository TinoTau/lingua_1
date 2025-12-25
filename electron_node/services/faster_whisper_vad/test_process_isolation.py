"""
测试进程隔离架构
验证 ASR Worker 进程隔离、自动重启和稳定性
"""
import requests
import time
import base64
import numpy as np
import logging
import concurrent.futures
from typing import List, Tuple

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:6007"


def create_mock_audio_data(duration_sec: float = 1.0, sample_rate: int = 16000) -> str:
    """创建模拟音频数据（PCM16格式）"""
    num_samples = int(duration_sec * sample_rate)
    # 生成简单的正弦波音频
    t = np.linspace(0, duration_sec, num_samples)
    audio = np.sin(2 * np.pi * 440 * t).astype(np.float32)  # 440Hz 正弦波
    # 转换为 PCM16
    audio_int16 = (audio * 32767).astype(np.int16)
    # 转换为 base64
    audio_bytes = audio_int16.tobytes()
    return base64.b64encode(audio_bytes).decode('utf-8')


def test_health_check() -> bool:
    """测试健康检查端点"""
    logger.info("=" * 60)
    logger.info("测试1: 健康检查")
    logger.info("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            logger.info("✅ 健康检查成功")
            logger.info(f"   状态: {data.get('status')}")
            
            asr_worker = data.get('asr_worker', {})
            logger.info(f"   Worker 状态: {asr_worker.get('worker_state')}")
            logger.info(f"   Worker PID: {asr_worker.get('worker_pid')}")
            logger.info(f"   队列深度: {asr_worker.get('queue_depth')}")
            logger.info(f"   总任务数: {asr_worker.get('total_tasks')}")
            logger.info(f"   完成任务数: {asr_worker.get('completed_tasks')}")
            logger.info(f"   失败任务数: {asr_worker.get('failed_tasks')}")
            logger.info(f"   Worker 重启次数: {asr_worker.get('worker_restarts')}")
            logger.info(f"   平均等待时间: {asr_worker.get('avg_wait_ms', 0):.2f}ms")
            
            # 验证 Worker 进程是否存在
            if asr_worker.get('worker_pid') is None:
                logger.warning("⚠️  Worker 进程未启动")
                return False
            
            if asr_worker.get('worker_state') != 'running':
                logger.warning(f"⚠️  Worker 状态异常: {asr_worker.get('worker_state')}")
                return False
            
            return True
        else:
            logger.error(f"❌ 健康检查失败: Status {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ 健康检查异常: {e}")
        return False


def test_single_request() -> bool:
    """测试单个请求"""
    logger.info("=" * 60)
    logger.info("测试2: 单个请求处理")
    logger.info("=" * 60)
    
    try:
        audio_b64 = create_mock_audio_data(duration_sec=1.0)
        payload = {
            "job_id": f"test_single_{int(time.time())}",
            "src_lang": "zh",
            "audio": audio_b64,
            "audio_format": "pcm16",
            "sample_rate": 16000,
            "task": "transcribe",
            "beam_size": 5,
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "trace_id": f"test_single_{int(time.time())}"
        }
        
        start_time = time.time()
        response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=60)
        elapsed = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"✅ 单个请求成功 (耗时 {elapsed:.2f}s)")
            logger.info(f"   文本: {data.get('text', '')[:100]}...")
            logger.info(f"   语言: {data.get('language', 'N/A')}")
            logger.info(f"   时长: {data.get('duration', 0):.2f}s")
            logger.info(f"   分段数: {len(data.get('segments', []))}")
            return True
        else:
            logger.error(f"❌ 单个请求失败: Status {response.status_code}, {response.text}")
            return False
    except Exception as e:
        logger.error(f"❌ 单个请求异常: {e}", exc_info=True)
        return False


def test_queue_backpressure() -> bool:
    """测试队列背压控制"""
    logger.info("=" * 60)
    logger.info("测试3: 队列背压控制")
    logger.info("=" * 60)
    
    try:
        audio_b64 = create_mock_audio_data(duration_sec=2.0)
        
        # 快速发送多个请求，填满队列
        futures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            for i in range(5):
                payload = {
                    "job_id": f"test_backpressure_{i}_{int(time.time())}",
                    "src_lang": "zh",
                    "audio": audio_b64,
                    "audio_format": "pcm16",
                    "sample_rate": 16000,
                    "task": "transcribe",
                    "trace_id": f"test_backpressure_{i}"
                }
                future = executor.submit(
                    requests.post,
                    f"{BASE_URL}/utterance",
                    json=payload,
                    timeout=10
                )
                futures.append(future)
                time.sleep(0.1)  # 快速发送
        
        # 检查是否有 503 响应
        has_503 = False
        success_count = 0
        for i, future in enumerate(futures):
            try:
                response = future.result(timeout=15)
                if response.status_code == 503:
                    has_503 = True
                    logger.info(f"✅ 请求 {i} 返回 503 (队列满，符合预期)")
                elif response.status_code == 200:
                    success_count += 1
                    logger.info(f"✅ 请求 {i} 成功处理")
                else:
                    logger.warning(f"⚠️  请求 {i} 返回 {response.status_code}")
            except Exception as e:
                logger.warning(f"⚠️  请求 {i} 异常: {e}")
        
        logger.info(f"   成功: {success_count}, 503: {has_503}")
        
        # 至少应该有一些请求成功或返回 503
        if success_count > 0 or has_503:
            logger.info("✅ 队列背压控制测试通过")
            return True
        else:
            logger.error("❌ 队列背压控制测试失败")
            return False
            
    except Exception as e:
        logger.error(f"❌ 队列背压控制测试异常: {e}", exc_info=True)
        return False


def test_concurrent_requests(num_requests: int = 5) -> bool:
    """测试并发请求"""
    logger.info("=" * 60)
    logger.info(f"测试4: 并发请求处理 ({num_requests} 个请求)")
    logger.info("=" * 60)
    
    try:
        audio_b64 = create_mock_audio_data(duration_sec=1.0)
        
        def send_request(i: int) -> Tuple[int, bool, float]:
            """发送单个请求"""
            payload = {
                "job_id": f"test_concurrent_{i}_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": 16000,
                "task": "transcribe",
                "trace_id": f"test_concurrent_{i}"
            }
            
            start_time = time.time()
            try:
                response = requests.post(
                    f"{BASE_URL}/utterance",
                    json=payload,
                    timeout=60
                )
                elapsed = time.time() - start_time
                success = response.status_code == 200
                return i, success, elapsed
            except Exception as e:
                elapsed = time.time() - start_time
                logger.warning(f"请求 {i} 异常: {e}")
                return i, False, elapsed
        
        # 并发发送请求
        start_time = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=num_requests) as executor:
            futures = [executor.submit(send_request, i) for i in range(num_requests)]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]
        
        total_elapsed = time.time() - start_time
        
        # 统计结果
        success_count = sum(1 for _, success, _ in results if success)
        failed_count = num_requests - success_count
        avg_elapsed = sum(elapsed for _, _, elapsed in results) / len(results) if results else 0
        
        logger.info(f"   总耗时: {total_elapsed:.2f}s")
        logger.info(f"   成功: {success_count}/{num_requests}")
        logger.info(f"   失败: {failed_count}/{num_requests}")
        logger.info(f"   平均请求耗时: {avg_elapsed:.2f}s")
        
        # 检查服务是否仍然可用
        health_ok = test_health_check()
        
        if success_count > 0 and health_ok:
            logger.info("✅ 并发请求测试通过（服务未崩溃）")
            return True
        else:
            logger.error("❌ 并发请求测试失败")
            return False
            
    except Exception as e:
        logger.error(f"❌ 并发请求测试异常: {e}", exc_info=True)
        return False


def test_worker_restart() -> bool:
    """测试 Worker 自动重启（需要手动触发崩溃或等待）"""
    logger.info("=" * 60)
    logger.info("测试5: Worker 自动重启机制")
    logger.info("=" * 60)
    
    try:
        # 获取初始状态
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False
        
        initial_data = response.json()
        initial_restarts = initial_data.get('asr_worker', {}).get('worker_restarts', 0)
        initial_pid = initial_data.get('asr_worker', {}).get('worker_pid')
        
        logger.info(f"   初始重启次数: {initial_restarts}")
        logger.info(f"   初始 Worker PID: {initial_pid}")
        
        # 等待一段时间，观察是否有自动重启
        logger.info("   等待 10 秒，观察 Worker 状态...")
        time.sleep(10)
        
        # 再次检查状态
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False
        
        final_data = response.json()
        final_restarts = final_data.get('asr_worker', {}).get('worker_restarts', 0)
        final_pid = final_data.get('asr_worker', {}).get('worker_pid')
        final_state = final_data.get('asr_worker', {}).get('worker_state')
        
        logger.info(f"   最终重启次数: {final_restarts}")
        logger.info(f"   最终 Worker PID: {final_pid}")
        logger.info(f"   最终 Worker 状态: {final_state}")
        
        # 验证服务仍然可用
        if final_state == 'running' and final_pid is not None:
            logger.info("✅ Worker 自动重启机制测试通过（服务正常运行）")
            if final_restarts > initial_restarts:
                logger.info(f"   检测到 {final_restarts - initial_restarts} 次重启")
            return True
        else:
            logger.error("❌ Worker 状态异常")
            return False
            
    except Exception as e:
        logger.error(f"❌ Worker 自动重启测试异常: {e}", exc_info=True)
        return False


def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("ASR 进程隔离架构测试")
    logger.info("=" * 60)
    logger.info("")
    
    results = []
    
    # 测试1: 健康检查
    results.append(("健康检查", test_health_check()))
    time.sleep(1)
    
    # 测试2: 单个请求
    results.append(("单个请求", test_single_request()))
    time.sleep(2)
    
    # 测试3: 队列背压控制
    results.append(("队列背压控制", test_queue_backpressure()))
    time.sleep(2)
    
    # 测试4: 并发请求
    results.append(("并发请求", test_concurrent_requests(5)))
    time.sleep(2)
    
    # 测试5: Worker 自动重启
    results.append(("Worker 自动重启", test_worker_restart()))
    
    # 打印测试结果
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试结果总结")
    logger.info("=" * 60)
    
    passed = 0
    failed = 0
    
    for test_name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"{test_name}: {status}")
        if result:
            passed += 1
        else:
            failed += 1
    
    logger.info("")
    logger.info(f"总计: {passed} 通过, {failed} 失败")
    
    if failed == 0:
        logger.info("")
        logger.info("🎉 所有测试通过！")
        return 0
    else:
        logger.info("")
        logger.info("⚠️  部分测试失败，请检查日志")
        return 1


if __name__ == "__main__":
    exit(main())

