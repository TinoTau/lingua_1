"""
简化版进程隔离架构测试（只使用 requests）
验证 ASR Worker 进程隔离和健康状态
"""
import requests
import time
import base64
import struct
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:6007"


def create_mock_pcm16_audio(duration_sec: float = 1.0, sample_rate: int = 16000) -> str:
    """创建模拟 PCM16 音频数据"""
    num_samples = int(duration_sec * sample_rate)
    # 生成简单的正弦波音频（440Hz）
    audio_data = bytearray()
    for i in range(num_samples):
        # 简单的正弦波：sin(2π * 440 * t)
        t = i / sample_rate
        sample = int(32767 * 0.3 * (1 if (int(t * 440) % 2 == 0) else -1))  # 方波近似
        audio_data.extend(struct.pack("<h", sample))
    
    return base64.b64encode(bytes(audio_data)).decode('utf-8')


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
            logger.info(f"   服务状态: {data.get('status')}")
            logger.info(f"   ASR 模型加载: {data.get('asr_model_loaded')}")
            logger.info(f"   VAD 模型加载: {data.get('vad_model_loaded')}")
            
            asr_worker = data.get('asr_worker', {})
            logger.info(f"   Worker 状态: {asr_worker.get('worker_state')}")
            logger.info(f"   Worker PID: {asr_worker.get('worker_pid')}")
            logger.info(f"   Worker 运行中: {asr_worker.get('is_running')}")
            logger.info(f"   队列深度: {asr_worker.get('queue_depth')}")
            logger.info(f"   总任务数: {asr_worker.get('total_tasks')}")
            logger.info(f"   完成任务数: {asr_worker.get('completed_tasks')}")
            logger.info(f"   失败任务数: {asr_worker.get('failed_tasks')}")
            logger.info(f"   Worker 重启次数: {asr_worker.get('worker_restarts')}")
            logger.info(f"   平均等待时间: {asr_worker.get('avg_wait_ms', 0):.2f}ms")
            logger.info(f"   待处理结果数: {asr_worker.get('pending_results')}")
            
            # 验证 Worker 进程是否存在
            if asr_worker.get('worker_pid') is None:
                logger.warning("⚠️  Worker 进程未启动")
                return False
            
            if asr_worker.get('worker_state') != 'running':
                logger.warning(f"⚠️  Worker 状态异常: {asr_worker.get('worker_state')}")
                return False
            
            logger.info("✅ Worker 进程正常运行")
            return True
        else:
            logger.error(f"❌ 健康检查失败: Status {response.status_code}")
            logger.error(f"   响应: {response.text}")
            return False
    except requests.exceptions.ConnectionError:
        logger.error("❌ 无法连接到服务，请确保服务已启动")
        return False
    except Exception as e:
        logger.error(f"❌ 健康检查异常: {e}")
        return False


def test_single_request() -> bool:
    """测试单个请求"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试2: 单个请求处理")
    logger.info("=" * 60)
    
    try:
        audio_b64 = create_mock_pcm16_audio(duration_sec=1.0)
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
        
        logger.info("   发送请求...")
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
            logger.error(f"❌ 单个请求失败: Status {response.status_code}")
            logger.error(f"   响应: {response.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"❌ 单个请求异常: {e}", exc_info=True)
        return False


def test_multiple_requests(num_requests: int = 3) -> bool:
    """测试多个顺序请求"""
    logger.info("")
    logger.info("=" * 60)
    logger.info(f"测试3: 多个顺序请求 ({num_requests} 个)")
    logger.info("=" * 60)
    
    success_count = 0
    audio_b64 = create_mock_pcm16_audio(duration_sec=1.0)
    
    for i in range(num_requests):
        try:
            payload = {
                "job_id": f"test_multi_{i}_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": 16000,
                "task": "transcribe",
                "trace_id": f"test_multi_{i}"
            }
            
            start_time = time.time()
            response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=60)
            elapsed = time.time() - start_time
            
            if response.status_code == 200:
                success_count += 1
                logger.info(f"   请求 {i+1}/{num_requests}: ✅ 成功 (耗时 {elapsed:.2f}s)")
            else:
                logger.warning(f"   请求 {i+1}/{num_requests}: ❌ 失败 (Status {response.status_code})")
            
            # 短暂延迟，避免过快
            time.sleep(0.5)
            
        except Exception as e:
            logger.warning(f"   请求 {i+1}/{num_requests}: ❌ 异常: {e}")
    
    logger.info(f"   成功: {success_count}/{num_requests}")
    
    # 再次检查健康状态
    logger.info("")
    logger.info("   检查服务健康状态...")
    health_ok = test_health_check()
    
    if success_count > 0 and health_ok:
        logger.info("✅ 多个顺序请求测试通过（服务未崩溃）")
        return True
    else:
        logger.error("❌ 多个顺序请求测试失败")
        return False


def test_worker_status_monitoring() -> bool:
    """测试 Worker 状态监控"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试4: Worker 状态监控")
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
        initial_tasks = initial_data.get('asr_worker', {}).get('total_tasks', 0)
        
        logger.info(f"   初始状态:")
        logger.info(f"     Worker PID: {initial_pid}")
        logger.info(f"     重启次数: {initial_restarts}")
        logger.info(f"     总任务数: {initial_tasks}")
        
        # 等待一段时间
        logger.info("   等待 5 秒，观察 Worker 状态变化...")
        time.sleep(5)
        
        # 再次检查状态
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False
        
        final_data = response.json()
        final_restarts = final_data.get('asr_worker', {}).get('worker_restarts', 0)
        final_pid = final_data.get('asr_worker', {}).get('worker_pid')
        final_state = final_data.get('asr_worker', {}).get('worker_state')
        final_tasks = final_data.get('asr_worker', {}).get('total_tasks', 0)
        
        logger.info(f"   最终状态:")
        logger.info(f"     Worker PID: {final_pid}")
        logger.info(f"     Worker 状态: {final_state}")
        logger.info(f"     重启次数: {final_restarts}")
        logger.info(f"     总任务数: {final_tasks}")
        
        # 验证服务仍然可用
        if final_state == 'running' and final_pid is not None:
            logger.info("✅ Worker 状态监控测试通过（服务正常运行）")
            if final_restarts > initial_restarts:
                logger.info(f"   检测到 {final_restarts - initial_restarts} 次重启（可能是自动恢复）")
            return True
        else:
            logger.error("❌ Worker 状态异常")
            return False
            
    except Exception as e:
        logger.error(f"❌ Worker 状态监控测试异常: {e}", exc_info=True)
        return False


def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("ASR 进程隔离架构测试（简化版）")
    logger.info("=" * 60)
    logger.info("")
    
    results = []
    
    # 测试1: 健康检查
    results.append(("健康检查", test_health_check()))
    time.sleep(1)
    
    # 测试2: 单个请求
    results.append(("单个请求", test_single_request()))
    time.sleep(2)
    
    # 测试3: 多个顺序请求
    results.append(("多个顺序请求", test_multiple_requests(3)))
    time.sleep(2)
    
    # 测试4: Worker 状态监控
    results.append(("Worker 状态监控", test_worker_status_monitoring()))
    
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
        logger.info("🎉 所有测试通过！进程隔离架构工作正常。")
        return 0
    else:
        logger.info("")
        logger.info("⚠️  部分测试失败，请检查日志和服务状态。")
        return 1


if __name__ == "__main__":
    exit(main())

