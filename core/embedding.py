import os
import json
import requests
import logging
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 配置日志
logger = logging.getLogger(__name__)

# 获取 Ollama 配置
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "192.168.68.28")
OLLAMA_PORT = os.getenv("OLLAMA_PORT", "11434")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

OLLAMA_API_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/embeddings"

def get_embedding(text: str) -> list:
    """
    调用 Ollama API 获取文本的向量表示
    
    Args:
        text (str): 需要向量化的文本
        
    Returns:
        list: 浮点数列表（向量），如果失败则返回 None
    """
    if not text or not text.strip():
        return None
        
    try:
        payload = {
            "model": OLLAMA_EMBED_MODEL,
            "prompt": text
        }
        
        response = requests.post(OLLAMA_API_URL, json=payload, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if "embedding" in data:
            return data["embedding"]
        else:
            logger.error(f"Ollama API 响应中没有 embedding 字段: {data}")
            return None
            
    except requests.exceptions.RequestException as e:
        logger.error(f"调用 Ollama API 失败: {e}")
        return None
    except Exception as e:
        logger.error(f"获取向量时发生未知错误: {e}")
        return None