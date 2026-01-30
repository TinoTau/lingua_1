#!/usr/bin/env python3
"""
End-to-End WebSocket Test for Scheduler Server
Tests: Node Registration + Client Session + Audio Translation
"""

import asyncio
import websockets
import json
import base64
import time
from pathlib import Path

# Configuration
SCHEDULER_WS_NODE = "ws://localhost:5010/ws/node"
SCHEDULER_WS_SESSION = "ws://localhost:5010/ws/session"
NODE_ID = "test-node-python-1"
AUDIO_DIR = Path(r"D:\Programs\github\lingua_1\expired")

# Colors for output
class Color:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    CYAN = '\033[96m'
    RESET = '\033[0m'

def log(message, color=None):
    timestamp = time.strftime("%H:%M:%S")
    if color:
        print(f"{color}[{timestamp}] {message}{Color.RESET}")
    else:
        print(f"[{timestamp}] {message}")

def read_audio_file(filename):
    """Read audio file and return base64 encoded data"""
    file_path = AUDIO_DIR / filename
    if not file_path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    
    with open(file_path, "rb") as f:
        audio_data = f.read()
    
    log(f"Read audio file: {filename} ({len(audio_data)} bytes)", Color.CYAN)
    return base64.b64encode(audio_data).decode('utf-8')

def create_node_register_message(node_id):
    """Create NodeRegister message"""
    return {
        "type": "node_register",
        "node_id": node_id,
        "version": "test-python-1.0",
        "capability_schema_version": "2.0",
        "platform": "windows",
        "hardware": {
            "cpu_cores": 8,
            "memory_gb": 16,
            "gpus": [{"name": "Test GPU", "memory_gb": 8}]
        },
        "installed_models": [
            {
                "model_id": "whisper-medium",
                "kind": "asr",
                "src_lang": "en",
                "tgt_lang": None,
                "dialect": None
            },
            {
                "model_id": "m2m100",
                "kind": "nmt",
                "src_lang": None,
                "tgt_lang": None,
                "dialect": None
            }
        ],
        "installed_services": [
            {
                "service_id": "whisper-asr",
                "type": "ASR",
                "device": "GPU",
                "status": "Running",
                "version": "1.0"
            },
            {
                "service_id": "m2m100-nmt",
                "type": "NMT",
                "device": "GPU",
                "status": "Running",
                "version": "1.0"
            },
            {
                "service_id": "piper-tts",
                "type": "TTS",
                "device": "CPU",
                "status": "Running",
                "version": "1.0"
            }
        ],
        "capability_by_type": [
            {
                "type": "ASR",
                "ready": True,
                "ready_impl_ids": ["whisper-asr"]
            },
            {
                "type": "NMT",
                "ready": True,
                "ready_impl_ids": ["m2m100-nmt"]
            },
            {
                "type": "TTS",
                "ready": True,
                "ready_impl_ids": ["piper-tts"]
            }
        ],
        "features_supported": {
            "streaming_asr": True,
            "batch_inference": False,
            "kv_cache": False
        },
        "accept_public_jobs": True,
        "language_capabilities": {
            "asr_languages": ["en", "zh"],
            "tts_languages": ["en", "zh"],
            "nmt_capabilities": [
                {
                    "model_id": "m2m100-nmt",
                    "languages": ["en", "zh"],
                    "rule": "any_to_any",
                    "supported_pairs": [
                        {"src": "en", "tgt": "zh"},
                        {"src": "zh", "tgt": "en"}
                    ]
                }
            ],
            "supported_language_pairs": [
                {"src": "en", "tgt": "zh"},
                {"src": "zh", "tgt": "en"}
            ]
        }
    }

def create_node_heartbeat_message(node_id):
    """Create NodeHeartbeat message"""
    return {
        "type": "node_heartbeat",
        "node_id": node_id,
        "timestamp": int(time.time() * 1000),
        "resource_usage": {
            "cpu_percent": 25.0,
            "gpu_percent": 15.0,
            "gpu_mem_percent": 30.0,
            "mem_percent": 45.0,
            "running_jobs": 0
        },
        "installed_services": [
            {
                "service_id": "whisper-asr",
                "type": "ASR",
                "device": "GPU",
                "status": "Running",
                "version": "1.0"
            },
            {
                "service_id": "m2m100-nmt",
                "type": "NMT",
                "device": "GPU",
                "status": "Running",
                "version": "1.0"
            },
            {
                "service_id": "piper-tts",
                "type": "TTS",
                "device": "CPU",
                "status": "Running",
                "version": "1.0"
            }
        ],
        "capability_by_type": [
            {"type": "ASR", "ready": True, "ready_impl_ids": ["whisper-asr"]},
            {"type": "NMT", "ready": True, "ready_impl_ids": ["m2m100-nmt"]},
            {"type": "TTS", "ready": True, "ready_impl_ids": ["piper-tts"]}
        ],
        "language_capabilities": {
            "asr_languages": ["en", "zh"],
            "tts_languages": ["en", "zh"],
            "nmt_capabilities": [
                {
                    "model_id": "m2m100-nmt",
                    "languages": ["en", "zh"],
                    "rule": "any_to_any",
                    "supported_pairs": [
                        {"src": "en", "tgt": "zh"},
                        {"src": "zh", "tgt": "en"}
                    ]
                }
            ],
            "supported_language_pairs": [
                {"src": "en", "tgt": "zh"},
                {"src": "zh", "tgt": "en"}
            ]
        }
    }

def create_session_init_message():
    """Create SessionInit message"""
    return {
        "type": "session_init",
        "client_version": "test-python-1.0",
        "platform": "web",
        "src_lang": "en",
        "tgt_lang": "zh",
        "enable_streaming_asr": True,
        "partial_update_interval_ms": 200,
        "trace_id": f"test-trace-{int(time.time())}"
    }

def create_utterance_message(session_id, audio_base64, src_lang, tgt_lang, utterance_index=0):
    """Create Utterance message"""
    return {
        "type": "utterance",
        "session_id": session_id,
        "utterance_index": utterance_index,
        "manual_cut": True,
        "src_lang": src_lang,
        "tgt_lang": tgt_lang,
        "pipeline": {
            "use_asr": True,
            "use_nmt": True,
            "use_tts": True,
            "use_semantic": False,
            "use_tone": False
        },
        "audio": audio_base64,
        "audio_format": "wav",
        "sample_rate": 16000,
        "enable_streaming_asr": True,
        "partial_update_interval_ms": 200,
        "trace_id": f"test-trace-utt-{utterance_index}"
    }

async def simulate_node(node_id):
    """Simulate a node connecting to scheduler"""
    log(f"=== Node Simulation: {node_id} ===", Color.YELLOW)
    
    try:
        async with websockets.connect(SCHEDULER_WS_NODE) as websocket:
            log(f"Node connected to {SCHEDULER_WS_NODE}", Color.GREEN)
            
            # Send NodeRegister
            register_msg = create_node_register_message(node_id)
            await websocket.send(json.dumps(register_msg))
            log("Sent NodeRegister", Color.CYAN)
            
            # Wait for NodeRegisterAck
            response = await websocket.recv()
            ack = json.loads(response)
            if ack.get("type") == "node_register_ack":
                log(f"Received NodeRegisterAck: node_id={ack.get('node_id')}, status={ack.get('status')}", Color.GREEN)
            else:
                log(f"Unexpected response: {ack}", Color.RED)
            
            # Send heartbeats to change status from registering -> ready
            for i in range(3):
                await asyncio.sleep(0.5)
                heartbeat_msg = create_node_heartbeat_message(node_id)
                await websocket.send(json.dumps(heartbeat_msg))
                log(f"Sent NodeHeartbeat #{i+1}", Color.CYAN)
            
            log("Node registration complete (status -> ready)", Color.GREEN)
            
            # Keep sending heartbeats and handling job assignments
            heartbeat_count = 3
            while True:
                try:
                    # Check for incoming messages (job assignments)
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    msg_data = json.loads(message)
                    
                    if msg_data.get("type") == "job_assign":
                        log(f"Received JobAssign: job_id={msg_data.get('job_id')}", Color.YELLOW)
                        
                        # Send JobAck
                        ack_msg = {
                            "type": "job_ack",
                            "job_id": msg_data["job_id"],
                            "attempt_id": msg_data["attempt_id"],
                            "node_id": node_id,
                            "session_id": msg_data["session_id"],
                            "trace_id": msg_data.get("trace_id", "")
                        }
                        await websocket.send(json.dumps(ack_msg))
                        log(f"Sent JobAck for job {msg_data['job_id']}", Color.CYAN)
                        
                        # Simulate processing (ASR + NMT + TTS)
                        await asyncio.sleep(0.5)
                        
                        # Send JobResult
                        result_msg = {
                            "type": "job_result",
                            "job_id": msg_data["job_id"],
                            "attempt_id": msg_data["attempt_id"],
                            "node_id": node_id,
                            "session_id": msg_data["session_id"],
                            "utterance_index": msg_data["utterance_index"],
                            "asr_text": "Hello, this is a test message",
                            "translated_text": "你好，这是一条测试消息",
                            "tts_audio": "",  # Empty for simplicity
                            "status": "success",
                            "processing_time_ms": 500,
                            "trace_id": msg_data.get("trace_id", "")
                        }
                        await websocket.send(json.dumps(result_msg))
                        log(f"Sent JobResult for job {msg_data['job_id']}", Color.GREEN)
                    
                except asyncio.TimeoutError:
                    # No incoming message, send heartbeat
                    heartbeat_count += 1
                    heartbeat_msg = create_node_heartbeat_message(node_id)
                    await websocket.send(json.dumps(heartbeat_msg))
                    log(f"Sent NodeHeartbeat #{heartbeat_count}", Color.CYAN)
                    
    except Exception as e:
        log(f"Node error: {e}", Color.RED)

async def simulate_client():
    """Simulate a client session"""
    log("=== Client Simulation ===", Color.YELLOW)
    
    # Wait for node to register
    await asyncio.sleep(2)
    
    try:
        async with websockets.connect(SCHEDULER_WS_SESSION) as websocket:
            log(f"Client connected to {SCHEDULER_WS_SESSION}", Color.GREEN)
            
            # Send SessionInit
            init_msg = create_session_init_message()
            await websocket.send(json.dumps(init_msg))
            log("Sent SessionInit", Color.CYAN)
            
            # Wait for SessionInitAck
            response = await websocket.recv()
            ack = json.loads(response)
            if ack.get("type") == "session_init_ack":
                session_id = ack.get("session_id")
                log(f"Received SessionInitAck: session_id={session_id}", Color.GREEN)
            else:
                log(f"Unexpected response: {ack}", Color.RED)
                return
            
            # Test 1: English -> Chinese
            log("\n=== Test 1: English -> Chinese ===", Color.YELLOW)
            try:
                english_audio = read_audio_file("english.wav")
                utt_msg = create_utterance_message(session_id, english_audio, "en", "zh", utterance_index=0)
                await websocket.send(json.dumps(utt_msg))
                log("Sent Utterance (English audio)", Color.CYAN)
                
                # Wait for results
                timeout = 10
                start_time = time.time()
                while time.time() - start_time < timeout:
                    result = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                    result_data = json.loads(result)
                    
                    if result_data.get("type") == "translation_result":
                        log(f"Received TranslationResult:", Color.GREEN)
                        log(f"  ASR: {result_data.get('asr_text', 'N/A')}", Color.CYAN)
                        log(f"  Translation: {result_data.get('translated_text', 'N/A')}", Color.CYAN)
                        break
                    elif result_data.get("type") == "partial_asr_result":
                        log(f"Received PartialASR: {result_data.get('text', 'N/A')}", Color.CYAN)
                    elif result_data.get("type") == "error":
                        log(f"Error: {result_data.get('message')}", Color.RED)
                        break
                        
            except FileNotFoundError as e:
                log(f"Skip Test 1: {e}", Color.YELLOW)
            except asyncio.TimeoutError:
                log("Test 1: Timeout waiting for result", Color.RED)
            
            # Test 2: Chinese -> English
            log("\n=== Test 2: Chinese -> English ===", Color.YELLOW)
            try:
                chinese_audio = read_audio_file("chinese.wav")
                utt_msg = create_utterance_message(session_id, chinese_audio, "zh", "en", utterance_index=1)
                await websocket.send(json.dumps(utt_msg))
                log("Sent Utterance (Chinese audio)", Color.CYAN)
                
                # Wait for results
                timeout = 10
                start_time = time.time()
                while time.time() - start_time < timeout:
                    result = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                    result_data = json.loads(result)
                    
                    if result_data.get("type") == "translation_result":
                        log(f"Received TranslationResult:", Color.GREEN)
                        log(f"  ASR: {result_data.get('asr_text', 'N/A')}", Color.CYAN)
                        log(f"  Translation: {result_data.get('translated_text', 'N/A')}", Color.CYAN)
                        break
                    elif result_data.get("type") == "partial_asr_result":
                        log(f"Received PartialASR: {result_data.get('text', 'N/A')}", Color.CYAN)
                    elif result_data.get("type") == "error":
                        log(f"Error: {result_data.get('message')}", Color.RED)
                        break
                        
            except FileNotFoundError as e:
                log(f"Skip Test 2: {e}", Color.YELLOW)
            except asyncio.TimeoutError:
                log("Test 2: Timeout waiting for result", Color.RED)
            
            log("\n=== Client tests complete ===", Color.GREEN)
            
    except Exception as e:
        log(f"Client error: {e}", Color.RED)

async def main():
    """Main test orchestrator"""
    log("=" * 60, Color.CYAN)
    log("WebSocket End-to-End Test", Color.CYAN)
    log("=" * 60, Color.CYAN)
    log(f"Scheduler Node WS: {SCHEDULER_WS_NODE}", Color.CYAN)
    log(f"Scheduler Session WS: {SCHEDULER_WS_SESSION}", Color.CYAN)
    log(f"Audio Directory: {AUDIO_DIR}", Color.CYAN)
    log("=" * 60, Color.CYAN)
    
    # Run node and client simulations in parallel
    node_task = asyncio.create_task(simulate_node(NODE_ID))
    client_task = asyncio.create_task(simulate_client())
    
    # Wait for client to complete (node runs indefinitely)
    await client_task
    
    # Give node some time to process remaining messages
    await asyncio.sleep(2)
    
    # Cancel node task
    node_task.cancel()
    try:
        await node_task
    except asyncio.CancelledError:
        pass
    
    log("\n" + "=" * 60, Color.CYAN)
    log("Test Complete!", Color.GREEN)
    log("=" * 60, Color.CYAN)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("\nTest interrupted by user", Color.YELLOW)
