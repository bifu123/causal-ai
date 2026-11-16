"""在内网 Linux 主机上执行命令（密码认证，非交互）。

用法：python tools/remote_exec.py "<command>" ["<command2>" ...]
环境变量：SSH_HOST, SSH_USER, SSH_PASS, SSH_PATH
"""
import os
import sys

import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.66.39")
USER = os.environ.get("SSH_USER", "root")
PASS = os.environ.get("SSH_PASS", "")
PATH = os.environ.get("SSH_PATH", "/root/causal_ai/")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=20, look_for_keys=False, allow_agent=False)

commands = sys.argv[1:]
if not commands:
    commands = ["pwd"]

for cmd in commands:
    # 参数若指向本地文件，则把文件内容作为远程命令执行（避免 Windows 引号转义问题）
    if os.path.isfile(cmd):
        with open(cmd, "r", encoding="utf-8") as f:
            cmd = f.read()
    full = f"cd {PATH} && {cmd}"
    print(f"$ {full}", flush=True)
    stdin, stdout, stderr = client.exec_command(full, timeout=1800, get_pty=True)
    out = stdout.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip(), flush=True)
    print(f"[exit={code}]", flush=True)

client.close()
