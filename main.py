import asyncio
import os
import uuid
import uvicorn
from datetime import datetime
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, Response
from fastapi_socketio import SocketManager
from pydantic import BaseModel
from typing import Optional, List, Union

from core.database import db
from core.metabolism import MetabolismEngine

# --- 应用初始化 ---
app = FastAPI(title="AINS Causal Station")

# 目录配置 - 使用当前工作目录，因为文件可能在 symbolic link 或不同位置
# 首先尝试使用当前工作目录
CURRENT_DIR = os.getcwd()
print(f"[系统] 当前工作目录: {CURRENT_DIR}")
print(f"[系统] __file__ 目录: {os.path.dirname(os.path.abspath(__file__))}")

# 优先使用当前工作目录，因为静态文件在那里
BASE_DIR = CURRENT_DIR

# 确保静态目录存在
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)
    print(f"[系统] 创建静态目录: {static_dir}")
else:
    print(f"[系统] 静态目录已存在: {static_dir}")

# 列出静态目录内容
print(f"[系统] 静态目录内容:")
for root, dirs, files in os.walk(static_dir):
    level = root.replace(static_dir, '').count(os.sep)
    indent = ' ' * 2 * level
    print(f'{indent}{os.path.basename(root)}/')
    subindent = ' ' * 2 * (level + 1)
    for file in files:
        print(f'{subindent}{file}')

# 配置静态文件服务 - 使用更明确的配置
app.mount("/static", StaticFiles(directory=static_dir, html=True), name="static")
print(f"[系统] 静态文件服务已配置: /static -> {static_dir}")

# 添加uploads目录的静态文件服务（使用绝对路径）
uploads_path = os.path.join(BASE_DIR, "uploads")
if not os.path.exists(uploads_path):
    os.makedirs(uploads_path, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_path), name="uploads")

templates = Jinja2Templates(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates"))
print(f"[系统] 模板目录: {os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')}")

# 测试静态文件服务
@app.get("/test-static")
async def test_static():
    """测试静态文件服务是否正常工作"""
    static_files = []
    try:
        for root, dirs, files in os.walk(static_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # 确保是文件且可读
                if os.path.isfile(file_path) and os.access(file_path, os.R_OK):
                    rel_path = os.path.relpath(file_path, static_dir)
                    # 使用正斜杠，确保URL格式正确
                    url_path = f"/static/{rel_path}".replace('\\', '/')
                    static_files.append(url_path)
        
        # 也直接测试socket.io文件
        socketio_path = os.path.join(static_dir, "js", "socket.io.min.js")
        socketio_exists = os.path.exists(socketio_path)
        socketio_readable = os.access(socketio_path, os.R_OK) if socketio_exists else False
        
        return {
            "status": "success",
            "static_dir": static_dir,
            "files": static_files,
            "socketio_file": {
                "path": socketio_path,
                "exists": socketio_exists,
                "readable": socketio_readable,
                "url": "/static/js/socket.io.min.js"
            },
            "message": f"静态目录: {static_dir}, 共 {len(static_files)} 个文件"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "static_dir": static_dir
        }

# 集成 Socket.IO
# 配置Socket.IO，确保与客户端v4兼容
sm = SocketManager(
    app=app,
    cors_allowed_origins="*",  # 允许所有来源，生产环境应限制
    mount_location="/socket.io",  # 明确指定挂载位置
    socketio_path="/socket.io"  # Socket.IO路径
)

# 实例化代谢引擎
metabolism = MetabolismEngine(socket_manager=sm, decay_rate=0.03, tick_interval=int(os.getenv("TICK_INTERVAL")))

# AINS 协议模型
class CausalNodeRequest(BaseModel):
    node_id: str
    parent_id: Optional[Union[str, List[str]]] = None
    block_tag: str = "因"
    action_tag: str = "贞"
    event_tuple: str
    full_image_url: Optional[str] = None
    owner_id: Optional[str] = "default"

@app.get("/ui", response_class=HTMLResponse)
async def get_ui(request: Request):
    """因果感知 UI 观测站"""
    return templates.TemplateResponse(request=request, name="2d_main.html")

@app.get("/3d", response_class=HTMLResponse)
async def get_3d_visualization(request: Request):
    """3D 因果星空可视化页面"""
    return templates.TemplateResponse(request=request, name="3d_main.html")

@app.get("/socketio-test", response_class=HTMLResponse)
async def get_socketio_test(request: Request):
    """Socket.IO 同步问题测试页面"""
    return templates.TemplateResponse(request=request, name="socketio_test.html")

# --- 文件上传接口 ---
@app.post("/api/v1/causal/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    职责：处理图片上传，保存到 uploads/raw 目录
    """
    try:
        # 确保上传目录存在
        upload_dir = "uploads/raw"
        os.makedirs(upload_dir, exist_ok=True)
        
        # 生成唯一文件名
        file_ext = os.path.splitext(file.filename)[1] if '.' in file.filename else '.png'
        unique_filename = f"{uuid.uuid4().hex}{file_ext}"
        file_path = os.path.join(upload_dir, unique_filename)
        
        # 保存文件
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # 返回文件URL - 现在使用 /uploads/raw/ 路径
        file_url = f"/uploads/raw/{unique_filename}"
        return {
            "status": "success",
            "data": {
                "url": file_url,
                "filename": unique_filename
            }
        }
    except Exception as e:
        print(f"[API 错误] 文件上传失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 全局权重提升接口 ---
@app.post("/api/v1/causal/promote_chain")
async def promote_chain_weights(promote_data: dict):
    """
    职责：将点击的节点权重提升到所有节点总权重的60%（大股东模式）。
    当节点被点击时，将该节点的权重设置为60%，所有其他节点按现有权重比例分配剩余的40%。
    支持actor_id参数：如果提供actor_id，更新用户权重表；否则更新全局权重。
    支持owner_id参数：如果提供owner_id，只处理属于该owner_id的节点。
    """
    try:
        node_id = promote_data.get('node_id')
        actor_id = promote_data.get('actor_id')
        owner_id = promote_data.get('owner_id', 'default')
        
        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}
        
        # 提升节点权重（设置为大股东模式，权重60%）
        updated_nodes = db.promote_all_weights(node_id, actor_id=actor_id, owner_id=owner_id, set_as_boss=True)
        
        if not updated_nodes:
            return {"status": "error", "message": f"事件 '{node_id}' 没有找到"}
        
        # 广播所有更新的事件
        for node in updated_nodes:
            # 确保所有值都是JSON可序列化的
            if 'survival_weight' in node:
                node['survival_weight'] = float(node['survival_weight'])
            if 'last_accessed' in node:
                node['last_accessed'] = str(node['last_accessed'])
            if 'created_at' in node:
                node['created_at'] = str(node['created_at'])
            
            # 如果指定了actor_id，添加用户标识
            if actor_id:
                node['actor_id'] = actor_id
            
            # 添加owner_id标识
            node['owner_id'] = owner_id
            
            await sm.emit('node_updated', node)
        
        # 获取链中的最高权重（应该是60%）
        max_weight = 0.0
        for node in updated_nodes:
            weight = float(node.get('survival_weight', 0))
            if weight > max_weight:
                max_weight = weight
        
        message = f"节点权重已提升到所有节点总权重的 {max_weight:.4f}（大股东模式），共更新 {len(updated_nodes)} 个节点"
        if actor_id:
            message = f"用户 {actor_id} {message}"
        if owner_id != 'default':
            message = f"{message} (owner_id: {owner_id})"
        
        return {
            "status": "success",
            "message": message,
            "data": {
                "max_weight": max_weight,
                "updated_count": len(updated_nodes),
                "node_ids": [node['node_id'] for node in updated_nodes],
                "actor_id": actor_id,
                "owner_id": owner_id
            }
        }
    except Exception as e:
        print(f"[API 错误] 全局权重提升失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 地宫恢复接口 ---
@app.post("/api/v1/causal/restore")
async def restore_from_necropolis(restore_data: dict):
    """
    职责：从地宫表恢复内容到活跃事件表。
    当节点被点击时，从地宫表ains_archive_necropolis中调入raw_content的值
    (sealed_at最晚的记录）来替换ains_active_nodes表中event_tuple，
    full_image_path来替换ains_active_nodes中的full_image_path。
    """
    try:
        node_id = restore_data.get('node_id')
        
        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}
        
        # 从地宫表恢复内容
        restored_node = db.restore_from_necropolis(node_id)
        
        if not restored_node:
            return {"status": "error", "message": f"事件 '{node_id}' 没有地宫记录"}
        
        # 确保所有值都是JSON可序列化的
        if 'survival_weight' in restored_node:
            restored_node['survival_weight'] = float(restored_node['survival_weight'])
        if 'last_accessed' in restored_node:
            restored_node['last_accessed'] = str(restored_node['last_accessed'])
        if 'created_at' in restored_node:
            restored_node['created_at'] = str(restored_node['created_at'])
        
        # 添加标记，表示这是从地宫恢复的数据
        restored_node['from_necropolis'] = True
        restored_node['necropolis_restored_at'] = str(datetime.now())
        
        # 广播更新事件 - 包含完整的全息信息
        await sm.emit('node_updated', restored_node)
        
        # 记录恢复的详细信息
        print(f"[地宫恢复] 节点 {node_id} 已从地宫恢复完整内容")
        print(f"[地宫恢复] event_tuple 长度: {len(restored_node.get('event_tuple', ''))}")
        print(f"[地宫恢复] full_image_url: {restored_node.get('full_image_url', '无')}")
        
        return {
            "status": "success",
            "message": f"事件 '{node_id}' 已从地宫恢复完整全息信息",
            "data": restored_node,
            "necropolis_info": {
                "restored": True,
                "event_tuple_restored": 'event_tuple' in restored_node and restored_node['event_tuple'] is not None,
                "full_image_url_restored": 'full_image_url' in restored_node and restored_node['full_image_url'] is not None,
                "restored_at": str(datetime.now())
            }
        }
    except Exception as e:
        print(f"[API 错误] 地宫恢复失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 事件删除接口 ---
@app.post("/api/v1/causal/delete")
async def delete_node(delete_data: dict):
    """
    职责：删除事件
    逻辑：
    1. 删除数据库中本条记录
    2. 删除地宫表中对应记录
    3. 将其子事件的父ID更新为本事件的父ID
    4. 如果父ID为NULL（本事件为根事件），直接删除
    """
    try:
        node_id = delete_data.get('node_id')
        
        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}
        
        # 获取事件信息
        node = db.get_node_by_id(node_id)
        if not node:
            return {"status": "error", "message": f"找不到事件 '{node_id}'"}
        
        # 获取父事件ID列表（支持多父节点）
        parent_ids = node.get('parent_ids', [])
        
        # 删除事件（包括地宫表记录）
        db.delete_node_with_necropolis(node_id)
        
        # 更新子事件的父ID
        if parent_ids:
            # 如果有父节点，子节点继承这些父节点
            db.update_children_to_new_parent(node_id, parent_ids)
        else:
            # 如果是根事件，子事件变为新的根事件（父ID为NULL）
            db.update_children_to_null_parent(node_id)
        
        # 广播删除事件
        await sm.emit('node_deleted', {"node_id": node_id})
        
        return {
            "status": "success",
            "message": f"事件 '{node_id}' 已删除，子事件已重新连接"
        }
    except Exception as e:
        print(f"[API 错误] 事件删除失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 事件更新接口 ---
@app.post("/api/v1/causal/update")
async def update_node(update_data: dict):
    """
    职责：更新事件信息，包括修改node_id
    """
    try:
        old_node_id = update_data.get('old_node_id')
        new_node_id = update_data.get('new_node_id')
        event_tuple = update_data.get('event_tuple')
        full_image_url = update_data.get('full_image_url')
        parent_ids = update_data.get('parent_ids')
        owner_id = update_data.get('owner_id', 'default')
        
        if not old_node_id or not new_node_id:
            return {"status": "error", "message": "缺少必要参数"}
        
        # 检查新node_id是否已存在（除了当前事件）
        existing_node = db.get_node_by_id(new_node_id)
        if existing_node and new_node_id != old_node_id:
            return {"status": "error", "message": f"Node ID '{new_node_id}' 已存在"}
        
        # 获取原始事件数据
        original_node = db.get_node_by_id(old_node_id)
        if not original_node:
            return {"status": "error", "message": f"找不到事件 '{old_node_id}'"}
        
        # 构建更新数据
        update_node_data = {
            "node_id": new_node_id,
            "event_tuple": event_tuple if event_tuple is not None else original_node.get('event_tuple'),
            "full_image_url": full_image_url if full_image_url is not None else original_node.get('full_image_url')
        }
        
        # 如果有动作标签，添加到更新数据中
        if 'action_tag' in update_data:
            update_node_data['action_tag'] = update_data['action_tag']
        elif original_node.get('action_tag'):
            update_node_data['action_tag'] = original_node.get('action_tag')
        
        # 如果有因缘标签，添加到更新数据中
        if 'block_tag' in update_data:
            update_node_data['block_tag'] = update_data['block_tag']
        elif original_node.get('block_tag'):
            update_node_data['block_tag'] = original_node.get('block_tag')
        
        # 处理父ID
        parent_ids_list = []
        if parent_ids is not None:
            # 解析父ID字符串为列表
            if isinstance(parent_ids, str):
                if parent_ids.strip():
                    parent_ids_list = [pid.strip() for pid in parent_ids.split('|') if pid.strip()]
                else:
                    parent_ids_list = []
            elif isinstance(parent_ids, list):
                parent_ids_list = parent_ids
            else:
                parent_ids_list = []
        
        print(f"[更新节点] 父ID处理: parent_ids={parent_ids}, parent_ids_list={parent_ids_list}")
        
        # 检查是否为首贞（父ID为空）
        is_first_node = not parent_ids_list
        print(f"[更新节点] 是否为首贞: {is_first_node}")
        
        # 如果有父节点，验证它们是否存在
        if parent_ids_list:
            missing_parents = []
            for parent_id in parent_ids_list:
                parent = db.get_node_by_id(parent_id)
                if not parent:
                    missing_parents.append(parent_id)
            
            if missing_parents:
                return {
                    "status": "error", 
                    "message": f"因果断裂：找不到父事件 '{', '.join(missing_parents)}'，请先录入这些事件。"
                }
        
        # 设置父节点
        if is_first_node:
            # 首贞：没有父节点，设置为空列表（数据库会转换为NULL）
            update_node_data['parent_ids'] = []
            print(f"[更新节点] 设置父节点为空列表（首贞）")
        else:
            # 非首贞：有父节点
            update_node_data['parent_ids'] = parent_ids_list
            print(f"[更新节点] 设置父节点为: {parent_ids_list}")
        
        # 设置标签（如果是首贞，强制设置为"贞"和"因"）
        if is_first_node:
            # 首贞：强制设置为"贞"和"因"
            update_node_data['action_tag'] = "贞"
            update_node_data['block_tag'] = "因"
        else:
            # 非首贞：使用请求中的值或原始值
            if 'action_tag' in update_data:
                update_node_data['action_tag'] = update_data['action_tag']
            elif original_node.get('action_tag'):
                update_node_data['action_tag'] = original_node.get('action_tag')
            
            if 'block_tag' in update_data:
                update_node_data['block_tag'] = update_data['block_tag']
            elif original_node.get('block_tag'):
                update_node_data['block_tag'] = original_node.get('block_tag')
        
        # 如果node_id改变了，需要更新所有子事件的parent_id
        if old_node_id != new_node_id:
            # 更新当前事件
            db.update_node(old_node_id, update_node_data)
            
            # 更新所有子事件的parent_id
            db.update_children_parent_id(old_node_id, new_node_id)
            
            message = f"事件ID已从 '{old_node_id}' 更新为 '{new_node_id}'，并更新了所有子事件"
        else:
            # 只更新事件信息，不改变node_id
            db.update_node(old_node_id, update_node_data)
            message = "事件信息已更新"
        
        # 广播更新
        updated_node = db.get_node_by_id(new_node_id)
        if updated_node:
            # 确保所有值都是JSON可序列化的
            if 'survival_weight' in updated_node:
                updated_node['survival_weight'] = float(updated_node['survival_weight'])
            if 'last_accessed' in updated_node:
                updated_node['last_accessed'] = str(updated_node['last_accessed'])
            if 'created_at' in updated_node:
                updated_node['created_at'] = str(updated_node['created_at'])
            
            # 添加 old_node_id 字段，以便前端正确处理节点ID变化
            if old_node_id != new_node_id:
                updated_node['old_node_id'] = old_node_id
            
            # 添加 owner_id 字段
            updated_node['owner_id'] = owner_id
            
            await sm.emit('node_updated', updated_node)
        
        return {
            "status": "success",
            "message": message,
            "owner_id": owner_id
        }
    except Exception as e:
        print(f"[API 错误] 事件更新失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 历史数据接口：获取所有活跃事件 ---
@app.get("/api/v1/causal/history")
async def get_causal_history(actor_id: str = None, owner_id: str = None):
    """
    职责：返回所有活跃事件数据，用于前端初始化显示。
    支持参数：
        actor_id: 用户ID，如果提供则返回用户特定的权重数据
        owner_id: 事件拥有者ID，如果提供则只返回该拥有者的事件
    """
    try:
        # 如果没有提供owner_id，使用默认值'default'
        if owner_id is None:
            owner_id = 'default'
        
        if actor_id:
            # 获取指定owner_id的节点数据
            active_nodes = db.get_all_active(owner_id)
            
            # 检查是否有节点没有用户权重记录，如果有则创建默认记录
            # 注意：这里只处理属于当前owner_id的节点
            for node in active_nodes:
                serial_id = node.get('serial_id')
                if serial_id:
                    # 检查用户权重表中是否有该节点的记录
                    user_weight = db.get_user_weight(actor_id, serial_id)
                    if user_weight is None:
                        # 如果没有用户权重记录，创建默认记录（使用时间衰减权重）
                        # 使用节点的全局权重作为默认值
                        default_weight = float(node.get('survival_weight', 1.0))
                        db.set_user_weight(actor_id, serial_id, default_weight)
                        print(f"[用户权重初始化] 为用户 {actor_id} 创建节点 {node['node_id']} (serial_id: {serial_id}, owner_id: {owner_id}) 的默认权重: {default_weight}")
            
            # 重新获取用户节点数据（包含新创建的权重记录）
            # 注意：这里需要重新获取，因为get_user_nodes不支持owner_id参数
            # 所以我们需要手动处理：先获取owner_id的节点，然后应用用户权重
            active_nodes = db.get_all_active(owner_id)
            for node in active_nodes:
                serial_id = node.get('serial_id')
                if serial_id:
                    user_weight = db.get_user_weight(actor_id, serial_id)
                    if user_weight is not None:
                        node['survival_weight'] = user_weight
        else:
            # 获取指定owner_id的节点数据
            active_nodes = db.get_all_active(owner_id)
        
        # 转换数据格式以兼容 JSON 传输
        for node in active_nodes:
            node['last_accessed'] = str(node['last_accessed'])
            node['created_at'] = str(node['created_at'])
            node['survival_weight'] = float(node['survival_weight'])
        
        return {
            "status": "success",
            "data": active_nodes,
            "actor_id": actor_id,
            "owner_id": owner_id
        }
    except Exception as e:
        print(f"[API 错误] 获取历史数据失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 搜索接口：关键字搜索 ---
@app.post("/api/v1/causal/search/keyword")
async def search_by_keyword(search_data: dict):
    """
    职责：根据关键字搜索事件节点
    支持参数：
        keyword: 搜索关键词，支持逻辑与（&）操作符
        owner_id: 事件拥有者ID，如果为None则搜索所有事件
        limit: 返回结果数量限制，如果为None则返回所有行
    """
    try:
        keyword = search_data.get('keyword')
        owner_id = search_data.get('owner_id', 'default')
        limit = search_data.get('limit', 100)
        
        if not keyword:
            return {"status": "error", "message": "缺少搜索关键词"}
        
        # 导入搜索模块
        from core.search import get_event_with_params
        
        # 执行搜索
        results = get_event_with_params(keyword, owner_id, limit)
        
        # 将中文键名转换为英文键名，以便与前端保持一致
        converted_results = []
        for result in results:
            converted = {
                "serial_id": result.get("本事件ID"),
                "node_id": result.get("本事件标题"),
                "event_tuple": result.get("事件二元组描述"),
                "survival_weight": result.get("本事件权重"),
                "relevance_score": result.get("本事件相关度"),
                "block_tag": result.get("因缘标签"),
                "action_tag": result.get("动作标签"),
                "full_image_url": result.get("截图"),
                "owner_id": result.get("事件拥有者"),
                "parent_ids": result.get("前事件标题列表", []),
                "preview_id": result.get("前事件ID列表"),
                "next_ids": result.get("后续事件ID列表", [])
            }
            converted_results.append(converted)
        
        return {
            "status": "success",
            "data": converted_results,
            "count": len(converted_results),
            "keyword": keyword,
            "owner_id": owner_id
        }
    except Exception as e:
        print(f"[API 错误] 关键字搜索失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 搜索接口：序列ID搜索 ---
@app.post("/api/v1/causal/search/serial")
async def search_by_serial(search_data: dict):
    """
    职责：根据序列ID搜索事件节点
    支持参数：
        serial_id: 事件的物理序列ID
        actor_id: 用户ID（可选），如果提供则返回用户个性化权重
    """
    try:
        serial_id = search_data.get('serial_id')
        actor_id = search_data.get('actor_id')
        
        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}
        
        # 导入搜索模块
        from core.search import get_event_by_sid
        
        # 执行搜索（传递actor_id以获取用户个性化权重）
        result = get_event_by_sid(serial_id, actor_id=actor_id)
        
        if not result:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点"}
        
        # 将中文键名转换为英文键名，以便与前端保持一致
        converted_result = {
            "serial_id": result.get("本事件ID"),
            "node_id": result.get("本事件标题"),
            "event_tuple": result.get("事件二元组描述"),
            "survival_weight": result.get("本事件权重"),
            "block_tag": result.get("因缘标签"),
            "action_tag": result.get("动作标签"),
            "full_image_url": result.get("截图"),
            "owner_id": result.get("事件拥有者"),
            "parent_ids": result.get("前事件标题列表", []),
            "preview_id": result.get("前事件ID列表"),
            "next_ids": result.get("后续事件ID列表", []),
            "actor_id": actor_id if actor_id else None  # 添加actor_id字段
        }
        
        return {
            "status": "success",
            "data": converted_result,
            "actor_id": actor_id
        }
    except Exception as e:
        print(f"[API 错误] 序列ID搜索失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 点击事件接口 ---
@app.post("/api/v1/causal/click")
async def handle_node_click(click_data: dict):
    """
    职责：处理节点点击事件
    支持参数：
        serial_id: 事件节点的物理ID
        actor_id: 用户ID（可选）
        owner_id: 事件拥有者ID（可选）
    Action:
        1. 从地宫恢复内容（如果存在）
        2. 提升节点权重到60%（大股东模式）
        3. 重新计算其他节点权重
        4. 通过socketio更新到前端
    """
    try:
        serial_id = click_data.get('serial_id')
        actor_id = click_data.get('actor_id')
        owner_id = click_data.get('owner_id', 'default')
        
        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}
        
        print(f"[点击事件] 开始处理 serial_id: {serial_id}, actor_id: {actor_id}, owner_id: {owner_id}")
        
        # 1. 通过serial_id获取节点信息（传递actor_id以获取用户个性化权重）
        from core.search import get_event_by_sid
        search_result = get_event_by_sid(serial_id, actor_id=actor_id)
        if not search_result:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点"}
        
        # 将中文键名转换为英文键名
        node = {
            "serial_id": search_result.get("本事件ID"),
            "node_id": search_result.get("本事件标题"),
            "event_tuple": search_result.get("事件二元组描述"),
            "survival_weight": search_result.get("本事件权重"),
            "block_tag": search_result.get("因缘标签"),
            "action_tag": search_result.get("动作标签"),
            "full_image_url": search_result.get("截图"),
            "owner_id": search_result.get("事件拥有者"),
            "parent_ids": search_result.get("前事件标题列表", []),
            "preview_id": search_result.get("前事件ID列表"),
            "next_ids": search_result.get("后续事件ID列表", [])
        }
        
        node_id = node.get('node_id')
        print(f"[点击事件] 找到节点: {node_id} (serial_id: {serial_id})")
        
        # 2. 从地宫恢复内容（如果存在）
        restored_node = db.restore_from_necropolis(node_id)
        if restored_node:
            print(f"[点击事件] 已从地宫恢复节点 {node_id} 的完整内容")
            node = restored_node
        
        # 3. 提升节点权重（大股东模式：60%）
        updated_nodes = db.promote_all_weights(
            node_id=node_id,
            actor_id=actor_id,
            owner_id=owner_id,
            set_as_boss=True  # 设置为大股东模式
        )
        
        if not updated_nodes:
            print(f"[点击事件] 警告：权重提升未返回任何更新节点")
            # 即使没有更新节点，也返回当前节点信息
            return {
                "status": "success",
                "message": f"节点 {node_id} 信息已获取",
                "data": node,
                "updated_count": 0
            }
        
        # 4. 从更新节点中找到当前节点
        current_node = None
        for updated_node in updated_nodes:
            if updated_node.get('node_id') == node_id:
                current_node = updated_node
                break
        
        if not current_node:
            current_node = node
            print(f"[点击事件] 警告：在更新节点中未找到当前节点，使用原始节点")
        
        # 5. 广播所有更新的事件
        for updated_node in updated_nodes:
            # 确保所有值都是JSON可序列化的
            if 'survival_weight' in updated_node:
                updated_node['survival_weight'] = float(updated_node['survival_weight'])
            if 'last_accessed' in updated_node:
                updated_node['last_accessed'] = str(updated_node['last_accessed'])
            if 'created_at' in updated_node:
                updated_node['created_at'] = str(updated_node['created_at'])
            
            # 确保节点数据包含所有必要的物理键名
            # 如果缺少某些字段，从当前节点数据中补充
            if 'serial_id' not in updated_node and 'serial_id' in current_node:
                updated_node['serial_id'] = current_node['serial_id']
            if 'node_id' not in updated_node:
                updated_node['node_id'] = current_node.get('node_id', '')
            if 'event_tuple' not in updated_node and 'event_tuple' in current_node:
                updated_node['event_tuple'] = current_node['event_tuple']
            if 'block_tag' not in updated_node and 'block_tag' in current_node:
                updated_node['block_tag'] = current_node['block_tag']
            if 'action_tag' not in updated_node and 'action_tag' in current_node:
                updated_node['action_tag'] = current_node['action_tag']
            if 'full_image_url' not in updated_node and 'full_image_url' in current_node:
                updated_node['full_image_url'] = current_node['full_image_url']
            if 'parent_ids' not in updated_node and 'parent_ids' in current_node:
                updated_node['parent_ids'] = current_node['parent_ids']
            
            # 如果指定了actor_id，添加用户标识
            if actor_id:
                updated_node['actor_id'] = actor_id
            
            # 添加owner_id标识
            updated_node['owner_id'] = owner_id
            
            # 添加调试日志
            print(f"[点击事件广播] 节点 {updated_node.get('node_id')} 权重: {updated_node.get('survival_weight')}, 类型: {type(updated_node.get('survival_weight'))}")
            
            await sm.emit('node_updated', updated_node)
        
        print(f"[点击事件] 完成处理，更新了 {len(updated_nodes)} 个节点")
        
        return {
            "status": "success",
            "message": f"节点 {node_id} 权重已提升到60%（大股东模式）",
            "data": current_node,
            "updated_count": len(updated_nodes),
            "actor_id": actor_id,
            "owner_id": owner_id
        }
    except Exception as e:
        print(f"[API 错误] 点击事件处理失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 因果链骨架接口 ---
@app.post("/api/v1/causal/skeleton")
async def get_causal_skeleton(skeleton_data: dict):
    """
    职责：获取事件的因果链全息图骨架
    支持参数：
        serial_id: 事件的物理序列ID（必需）
        actor_id: 用户ID（可选），如果提供则返回用户个性化权重
    """
    try:
        serial_id = skeleton_data.get('serial_id')
        actor_id = skeleton_data.get('actor_id')
        
        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}
        
        # 导入搜索模块
        from core.search import get_event_skeleton
        
        # 执行因果链骨架查询
        skeleton = get_event_skeleton(serial_id, actor_id=actor_id)
        
        if not skeleton:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点或因果链为空"}
        
        return {
            "status": "success",
            "data": skeleton,
            "serial_id": serial_id,
            "actor_id": actor_id,
            "count": len(skeleton)
        }
    except Exception as e:
        print(f"[API 错误] 因果链骨架查询失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 核心接口：Genesis (首贞/又贞/对贞) ---
@app.post("/api/v1/causal/genesis")
async def create_genesis_node(node: CausalNodeRequest):
    """
    职责：接收因果推演请求。
    逻辑：
    1. 如果指定 parent_id，必须验证其在数据库中是否存在（溯源）。
    2. 严格执行 INSERT， node_id 重复则报错（禁止覆盖）。
    3. 对于首贞（没有父节点），强制设置：parent_id=None, action_tag="贞", block_tag="因"
    """
    
    # 处理父节点ID：可能是字符串、列表或|分隔的字符串
    parent_ids = []
    if node.parent_id is not None:
        if isinstance(node.parent_id, list):
            parent_ids = node.parent_id
        elif isinstance(node.parent_id, str):
            # 如果是|分隔的字符串，解析为列表
            if '|' in node.parent_id:
                parent_ids = [pid.strip() for pid in node.parent_id.split('|') if pid.strip()]
            else:
                parent_ids = [node.parent_id.strip()] if node.parent_id.strip() else []
    
    # 1. 因果溯源校验（支持多父节点）
    if parent_ids:
        # 验证所有父节点是否存在
        missing_parents = []
        for parent_id in parent_ids:
            parent = db.get_node_by_id(parent_id)
            if not parent:
                missing_parents.append(parent_id)
        
        if missing_parents:
            return {
                "status": "error", 
                "message": f"因果断裂：找不到父事件 '{', '.join(missing_parents)}'，请先录入前贞。"
            }
    
    # 2. 确定是否为首贞（没有父节点）
    is_first_node = not parent_ids
    
    # 3. 构造新事件字典
    new_node = {
        "node_id": node.node_id,
        "event_tuple": node.event_tuple,
        "survival_weight": 1.0,
        "full_image_url": node.full_image_url,
        "owner_id": node.owner_id
    }
    
    # 设置父节点
    if is_first_node:
        # 首贞：没有父节点
        new_node["parent_id"] = None
    else:
        # 非首贞：有父节点
        new_node["parent_id"] = parent_ids
    
    # 设置标签
    if is_first_node:
        # 首贞：强制设置为"贞"和"因"
        new_node["action_tag"] = "贞"
        new_node["block_tag"] = "因"
    else:
        # 非首贞：使用请求中的值或默认值
        new_node["action_tag"] = node.action_tag
        new_node["block_tag"] = node.block_tag

    try:
        # 4. 严格 INSERT (禁止覆盖)
        db.insert_node(new_node)
        
        # 5. 同步广播 - 确保所有值都是JSON可序列化的
        broadcast_node = new_node.copy()
        # 确保survival_weight是float类型
        if 'survival_weight' in broadcast_node:
            broadcast_node['survival_weight'] = float(broadcast_node['survival_weight'])
        
        await sm.emit('node_created', broadcast_node)
        print(f"[AINS] {new_node['action_tag']} 录入成功: {node.node_id}")
        
        return {"status": "success", "data": {"node_id": node.node_id}}
    
    except Exception as e:
        error_msg = str(e)
        if "already exists" in error_msg:
            return {
                "status": "error", 
                "message": f"冲突：事件 ID '{node.node_id}' 已存在。历史不可覆盖，请为新动作指定唯一 ID。"
            }
        print(f"[API 错误] {error_msg}")
        return {"status": "error", "message": error_msg}

# --- Socket 逻辑：全量数据同步 ---
@sm.on('connect')
async def handle_connect(sid, env):
    # 从Socket.IO连接查询参数中获取owner_id和actor_id
    query_string = env.get('QUERY_STRING', '')
    query_params = {}
    if query_string:
        from urllib.parse import parse_qs
        parsed = parse_qs(query_string)
        for key, value in parsed.items():
            if value:
                query_params[key] = value[0]
    
    owner_id = query_params.get('owner_id', 'default')
    actor_id = query_params.get('actor_id')
    
    print(f"[Socket.IO连接] sid={sid}, owner_id={owner_id}, actor_id={actor_id}")
    
    # 获取指定owner_id的节点数据
    active_nodes = db.get_all_active(owner_id)
    
    # 如果指定了actor_id，应用用户权重
    if actor_id:
        for node in active_nodes:
            serial_id = node.get('serial_id')
            if serial_id:
                user_weight = db.get_user_weight(actor_id, serial_id)
                if user_weight is not None:
                    node['survival_weight'] = user_weight
                    node['actor_id'] = actor_id
    
    for node in active_nodes:
        # 转换时间格式以兼容 JSON 传输
        node['last_accessed'] = str(node['last_accessed'])
        node['created_at'] = str(node['created_at'])
        # 将 Decimal 转为 float 传给前端
        node['survival_weight'] = float(node['survival_weight'])
        await sm.emit('node_created', node, to=sid)


# 定义读取源文件的通用函数
def read_file(file):
    try:
        with open(file, "r", encoding="utf-8") as f:
            content = f.read()
        return Response(content=content, media_type="text/plain; charset=utf-8")
    except Exception as e:
        return {"status": "error", "message": f"读取 {file} 失败: {str(e)}"}

# --- 文档和工具接口 ---
@app.get("/README.md", response_class=HTMLResponse)
async def get_readme_html(request: Request):
    """
    返回美化的 README.md HTML页面（针对人类用户）
    """
    try:
        return templates.TemplateResponse(request=request, name="readme.html")
    except Exception as e:
        return HTMLResponse(content=f"<h1>错误</h1><p>加载README页面失败: {str(e)}</p>")

@app.get("/api/readme/raw")
async def get_readme_raw():
    """
    返回原始的 README.md 文件内容（供JavaScript获取）
    """
    return read_file("README.md")

@app.get("/SKILL.md")
async def get_skill():
    """
    返回 SKILL.md 文件内容（保持原始格式，供Agent使用）
    """
    return read_file("SKILL.md")

@app.get("/tools")
async def get_tools():
    """
    返回 tools.py 文件内容（保持原始格式，供Agent使用）
    """
    return read_file("tools.py")

@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    """首页系统简介"""
    return templates.TemplateResponse(request=request, name="index.html")


# --- 启动代谢引擎 ---
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(metabolism.run())
    print("[系统] 因果代谢引擎已激活。")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8094)
