# -*- coding: utf-8 -*-
"""检查服务端口状态"""

import requests
import socket

def check_port(port):
    """检查端口是否开放"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    return result == 0

def check_service(port, endpoint='/health'):
    """检查服务健康状态"""
    try:
        url = f'http://localhost:{port}{endpoint}'
        response = requests.get(url, timeout=3)
        return {
            'port_open': True,
            'http_status': response.status_code,
            'content_type': response.headers.get('content-type', 'N/A'),
            'content': response.text[:200]
        }
    except requests.exceptions.ConnectionError:
        return {
            'port_open': check_port(port),
            'http_status': None,
            'error': 'Connection refused'
        }
    except Exception as e:
        return {
            'port_open': check_port(port),
            'http_status': None,
            'error': str(e)[:100]
        }

ports = {
    5011: 'semantic-repair-en',
    5012: 'en-normalize',
    5013: 'semantic-repair-zh',
}

print("="*60)
print("服务端口状态检查")
print("="*60)

for port, service_name in ports.items():
    print(f"\n[{service_name}] 端口 {port}:")
    result = check_service(port)
    if result.get('port_open'):
        print(f"  ✅ 端口已开放")
        if result.get('http_status'):
            print(f"  ✅ HTTP状态: {result['http_status']}")
            print(f"  📋 Content-Type: {result.get('content_type', 'N/A')}")
            print(f"  📋 响应内容: {result.get('content', 'N/A')[:100]}")
        else:
            print(f"  ⚠️  端口开放但HTTP服务不可用")
    else:
        print(f"  ❌ 端口未开放 - 服务可能未启动")
        if result.get('error'):
            print(f"  📋 错误: {result['error']}")
