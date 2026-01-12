# -*- coding: utf-8 -*-
"""检查Python进程的CPU占用"""

import psutil
import time

print("="*60)
print("Python进程CPU占用检查")
print("="*60)

# 获取所有Python进程
python_processes = []
for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
    try:
        if 'python' in proc.info['name'].lower():
            python_processes.append(proc)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass

if not python_processes:
    print("未找到Python进程")
    exit(0)

print(f"\n找到 {len(python_processes)} 个Python进程\n")

# 第一次采样
for proc in python_processes:
    try:
        proc.cpu_percent()  # 初始化
    except:
        pass

time.sleep(2)  # 等待2秒

# 第二次采样
print("CPU占用（2秒采样）:")
print("-" * 60)
for proc in python_processes:
    try:
        cpu_percent = proc.cpu_percent(interval=None)
        memory_mb = proc.memory_info().rss / 1024 / 1024
        cmdline = ' '.join(proc.info['cmdline'][:3]) if proc.info['cmdline'] else 'N/A'
        print(f"PID {proc.pid:6d}: {cpu_percent:5.1f}% CPU, {memory_mb:7.1f} MB - {cmdline}")
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        print(f"PID {proc.pid}: 无法访问 - {e}")

print("\n" + "="*60)
print("如果某个进程CPU占用持续>10%，可能存在以下问题：")
print("  1. 有后台任务在运行")
print("  2. 有轮询或定时任务")
print("  3. 内存泄漏导致频繁GC")
print("  4. 模型仍在初始化")
print("="*60)
