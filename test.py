#!/usr/bin/env python3
"""
测试脚本：调用 get_causal_chain()，ID：312
"""

import sys
import os
import json

# 添加当前目录到 Python 路径，以便导入 core 模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.search import get_event_skeleton
from core.database import db

# 1. 先通过 serial_id 312 获取节点信息，得到 node_id
node_info = get_event_skeleton(312)

# 3. 输出结果
print(json.dumps(node_info, ensure_ascii=False, indent=2, default=str))
