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
from core.access import resolve_access, sanitize_nodes, node_visible, is_shared, is_builtin_admin

# --- 应用初始化 ---
app = FastAPI(title="AINS Causal Station")

# 全局缓存：记录用户最后一次设置的 max_eyes
USER_MAX_EYES_CACHE = {}


def _env_max_eyes(default=30.0):
    """
    职责：读取 .env 中的 MAX_EYES（容忍 `MAX_EYES=40 # 注释` 这类行内注释），失败则回退默认值。
    用途：让「望远镜口径」max_eyes 与向量检索的 threshold 共用同一门槛
          （threshold = 1 - MAX_EYES/100，如 MAX_EYES=40 → 0.6，30 → 0.7）。
    """
    try:
        from dotenv import dotenv_values
        value = dotenv_values(".env").get("MAX_EYES")
        return float(value) if value not in (None, "") else float(default)
    except (TypeError, ValueError, OSError):
        return float(default)

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
    previous_node: Optional[Union[str, List[str]]] = None
    block_tag: str = "因"
    action_tag: str = "贞"
    event_tuple: str
    full_image_url: Optional[str] = None
    is_share: Optional[bool] = False
    owner_id: Optional[str] = "default"
    return_serial_id: Optional[bool] = None

@app.get("/ui", response_class=HTMLResponse)
async def get_ui(request: Request):
    """因果感知 UI 观测站"""
    return templates.TemplateResponse(request=request, name="2d_main.html")

@app.get("/3d", response_class=HTMLResponse)
async def get_3d_visualization(request: Request):
    """3D 因果星空可视化页面（注入访问权限上下文，供前端决定抽屉/按钮可见性）"""
    # 提取 URL 参数
    actor_id = request.query_params.get("actor_id")
    owner_id = request.query_params.get("owner_id", "default")

    # 解析访问权限（token > URL actor_id）
    access = resolve_access(request=request, owner_id=owner_id, actor_id=actor_id)
    # 页面内不再传播 token：只留权限结论
    safe_actor_id = access.actor_id or ""

    # 优先从全局缓存中获取该用户对该星空的 max_eyes 设置
    cache_key = f"{safe_actor_id}_{owner_id}" if safe_actor_id else None
    max_eyes = USER_MAX_EYES_CACHE.get(cache_key) if cache_key else None
    
    # 如果缓存中没有，则回退到 .env 配置
    if max_eyes is None:
        from dotenv import dotenv_values
        env_config = dotenv_values(".env")
        max_eyes = env_config.get("MAX_EYES", 30)
        
    return templates.TemplateResponse(
        request=request,
        name="3d_main.html",
        context={
            "max_eyes": max_eyes,
            "access": access.to_public(),
            "resolved_actor_id": safe_actor_id,
            "resolved_owner_id": owner_id,
        },
    )

@app.get("/socketio-test", response_class=HTMLResponse)
async def get_socketio_test(request: Request):
    """Socket.IO 同步问题测试页面"""
    return templates.TemplateResponse(request=request, name="socketio_test.html")

# --- 相似节点查询接口 ---
@app.get("/api/v1/causal/nodes/{node_id}/similar")
async def get_similar_nodes(request: Request, node_id: str, limit: int = 5, threshold: float = 0.5,
                           owner_id: str = "default", actor_id: str = None):
    """获取与指定节点语义相似的节点（按访问者可见性过滤）"""
    try:
        access = resolve_access(request=request, owner_id=owner_id, actor_id=actor_id)
        similar_nodes = db.get_similar_nodes(node_id, limit=limit, threshold=threshold)
        # 可见性过滤：观测者/匿名看不到场主私有节点
        if not access.can_read_private:
            visible = sanitize_nodes(similar_nodes, access)
            similar_nodes = [n for n in visible if not n.get('is_locked')]
        
        # 格式化返回数据
        formatted_nodes = []
        for node in similar_nodes:
            formatted_nodes.append({
                'node_id': node['node_id'],
                'previous_ids': node.get('previous_ids', []),
                'block_tag': node.get('block_tag'),
                'action_tag': node.get('action_tag'),
                'event_tuple': node.get('event_tuple'),
                'survival_weight': float(node.get('survival_weight', 1.0)),
                'vision_level': node.get('vision_level', 0),
                'full_image_url': node.get('full_image_url'),
                'similarity': float(node.get('similarity', 0.0))
            })
            
        return {
            'status': 'success',
            'data': formatted_nodes,
            'access': access.to_public()
        }
    
    except Exception as e:
        print(f"[API错误] 获取相似节点失败: {e}")
        return {
            'status': 'error',
            'message': str(e)
        }
    

# --- 文件上传接口 ---
@app.post("/api/v1/causal/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    """
    职责：处理图片上传，保存到 uploads/raw 目录
    鉴权：只有场主 / admin 可以上传（图片属于主副本内容）
    """
    try:
        access = resolve_access(request=request)
        if not access.can_write_master:
            return {"status": "error", "message": "只有场主或 admin 可以上传图片"}

        # 确保上传目录存在
        upload_dir = "uploads/raw"
        os.makedirs(upload_dir, exist_ok=True)
        
        # # 生成唯一文件名
        # file_ext = os.path.splitext(file.filename)[1] if '.' in file.filename else '.png'
        # unique_filename = f"{uuid.uuid4().hex}{file_ext}"
        # file_path = os.path.join(upload_dir, unique_filename)

        # 直接使用源文件的文件名（使用 os.path.basename 确保安全，防止路径穿越）
        unique_filename = os.path.basename(file.filename)
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
async def promote_chain_weights(promote_data: dict, request: Request):
    """
    职责：将点击的节点权重提升到所有节点总权重的60%（大股东模式）。
    当节点被点击时，将该节点的权重设置为60%，所有其他节点按现有权重比例分配剩余的40%。
    鉴权：
        - 有身份（token 或 URL actor_id）：权重写入该 actor 的用户副本；
        - 无身份（匿名）：拒绝；匿名观测者只读，不写任何权重。
    """
    try:
        node_id = promote_data.get('node_id')
        owner_id = promote_data.get('owner_id') or 'default'

        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}

        access = resolve_access(request=request, data=promote_data, owner_id=owner_id,
                                actor_id=promote_data.get('actor_id'))
        if not access.can_write_copy:
            return {"status": "error", "message": "匿名访客无权调整权重，请先登录"}

        actor_id = access.actor_id
        
        # 提升节点权重（设置为大股东模式，权重60%）
        updated_nodes = db.promote_all_weights(node_id, actor_id=actor_id, owner_id=owner_id, set_as_boss=True)
        
        if not updated_nodes:
            return {"status": "error", "message": f"事件 '{node_id}' 没有找到"}
        
        # 广播所有更新的事件（按节点可见性分房间，避免私有节点泄漏）
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
            node['owner_id'] = node.get('owner_id') or owner_id
            
            await broadcast_node('node_updated', node, access.owner_id, access)
        
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
async def restore_from_necropolis(restore_data: dict, request: Request):
    """
    职责：从地宫表恢复内容到活跃事件表。
    当节点被点击时，从地宫表ains_archive_necropolis中调入raw_content的值
    (sealed_at最晚的记录）来替换ains_active_nodes表中event_tuple，
    full_image_path来替换ains_active_nodes中的full_image_path。
    鉴权：恢复会写主副本，只有场主 / admin 可调用。
    """
    try:
        node_id = restore_data.get('node_id')

        access = resolve_access(request=request, data=restore_data,
                                owner_id=restore_data.get('owner_id') or 'default',
                                actor_id=restore_data.get('actor_id'))
        
        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}

        if not access.can_write_master:
            return {
                "status": "error",
                "message": "只有场主或 admin 可以从地宫恢复内容",
                "data": {"role": access.role}
            }
        
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
        
        # 广播更新事件 - 包含完整的全息信息（房间隔离）
        await broadcast_node('node_updated', restored_node, access.owner_id, access)
        
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
async def delete_node(delete_data: dict, request: Request):
    """
    职责：删除事件
    逻辑：
    1. 删除数据库中本条记录
    2. 删除地宫表中对应记录
    3. 将其子事件的父ID更新为本事件的父ID
    4. 如果父ID为NULL（本事件为根事件），直接删除
    鉴权：只有场主 / admin 可以删除主副本
    """
    try:
        node_id = delete_data.get('node_id')

        access = resolve_access(request=request, data=delete_data,
                                owner_id=delete_data.get('owner_id') or 'default',
                                actor_id=delete_data.get('actor_id'))
        
        if not node_id:
            return {"status": "error", "message": "缺少事件ID"}
        
        # 获取事件信息
        node = db.get_node_by_id(node_id)
        if not node:
            return {"status": "error", "message": f"找不到事件 '{node_id}'"}

        if not access.can_write_master:
            return {
                "status": "error",
                "message": "只有场主或 admin 可以删除事件",
                "data": {"role": access.role}
            }
        
        # 获取前事件ID列表（支持多前事件）
        previous_ids = node.get('previous_ids', [])
        
        # 删除事件（包括地宫表记录）
        db.delete_node_with_necropolis(node_id)
        
        # 更新子事件的前事件ID
        if previous_ids:
            # 如果有前事件，子节点继承这些前事件
            db.update_children_to_new_previous(node_id, previous_ids)
        else:
            # 如果是根事件，子事件变为新的根事件（前事件ID为NULL）
            db.update_children_to_null_previous(node_id)
        
        # 广播删除事件（房间隔离，按被删节点可见性发送）
        await broadcast_node('node_deleted', {
            "node_id": node_id,
            "owner_id": node.get('owner_id') or access.owner_id,
            "actor_id": node.get('actor_id'),
            "is_share": bool(node.get('is_share')),
        }, access.owner_id, access)
        
        return {
            "status": "success",
            "message": f"事件 '{node_id}' 已删除，子事件已重新连接"
        }
    except Exception as e:
        print(f"[API 错误] 事件删除失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 事件更新接口 ---
@app.post("/api/v1/causal/update")
async def update_node(update_data: dict, request: Request):
    """
    职责：更新事件信息，包括修改node_id
    鉴权：
        - 场主 / admin：更新主副本（正文、标签、is_share、node_id、连线），并同步自己的用户副本
        - 观测者：只更新自己用户副本中的连线（previous_ids），不触碰主副本
        - 匿名：拒绝
    """
    try:
        old_node_id = update_data.get('old_node_id')
        new_node_id = update_data.get('new_node_id')
        event_tuple = update_data.get('event_tuple')
        full_image_url = update_data.get('full_image_url')
        previous_ids = update_data.get('previous_ids')
        owner_id = update_data.get('owner_id', 'default')

        access = resolve_access(request=request, data=update_data, owner_id=owner_id,
                                actor_id=update_data.get('actor_id'))
        
        if not old_node_id or not new_node_id:
            return {"status": "error", "message": "缺少必要参数"}

        # 获取原始事件数据
        original_node = db.get_node_by_id(old_node_id)
        if not original_node:
            return {"status": "error", "message": f"找不到事件 '{old_node_id}'"}

        # 解析请求中的父ID（标题列表），供两条写路径共用
        previous_ids_list = []
        if previous_ids is not None:
            if isinstance(previous_ids, str):
                if previous_ids.strip():
                    previous_ids_list = [pid.strip() for pid in previous_ids.split('|') if pid.strip()]
            elif isinstance(previous_ids, list):
                previous_ids_list = previous_ids

        copy_actor = None
        if access.role == "admin":
            copy_actor = None  # Admin代理场主记账到活跃表，不写自己副本
        elif access.can_write_copy:
            copy_actor = access.actor_id
            
        # ============ 观测者 / 无主副本身份：只写自己的副本连线 ============
        if not access.can_write_master:
            if not copy_actor:
                return {"status": "error", "message": "匿名访客无权修改因果结构"}
            serial_id = original_node.get('serial_id')
            if not serial_id:
                return {"status": "error", "message": "该事件缺少 serial_id，无法建立用户副本"}
            if previous_ids is None:
                return {"status": "error", "message": "观测者只能调整自己副本的因果连线（previous_ids）"}

            # Admin不会走到这里，场主也不会，这个分支是纯粹的非场主观测者
            master_actor = access.master_actor_id
            db.ensure_user_copy(copy_actor, original_node, owner_actor=master_actor)
            
            parent_str = db._previous_to_string(previous_ids_list) or ""
            db.set_user_parent_link(copy_actor, serial_id, parent_str)
            print(f"[观测者副本] {copy_actor} 更新节点 {old_node_id} 的副本连线: {parent_str}")

            links = db.get_node_links(old_node_id, actor_id=copy_actor, owner_actor=master_actor)
            return {
                "status": "success",
                "message": "已更新你的私有因果连线",
                "scope": "user_copy",
                "previous_ids": links.get('previous_ids', []),
                "next_ids": links.get('next_ids', []),
                "actor_id": copy_actor,
                "owner_id": owner_id,
                "access": access.to_public(),
            }

        # ============ 场主 / admin：写主副本 ============
        # 检查新node_id是否已存在（除了当前事件）
        existing_node = db.get_node_by_id(new_node_id)
        if existing_node and new_node_id != old_node_id:
            return {"status": "error", "message": f"Node ID '{new_node_id}' 已存在"}
        
        # 构建更新数据
        update_node_data = {
            "node_id": new_node_id,
            "event_tuple": event_tuple if event_tuple is not None else original_node.get('event_tuple'),
            "full_image_url": full_image_url if full_image_url is not None else original_node.get('full_image_url')
        }

        if 'is_share' in update_data:
            update_node_data['is_share'] = update_data['is_share']
        
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
        
        # 处理父ID（previous_ids_list 已在上方解析）
        print(f"[更新节点] 父ID处理: previous_ids={previous_ids}, previous_ids_list={previous_ids_list}")
        
        # 检查是否为首贞（父ID为空）
        is_first_node = not previous_ids_list


            
        
        # 设置前事件
        if is_first_node:
            # 首贞：没有前事件，设置为空列表（数据库会转换为NULL）
            update_node_data['previous_ids'] = []
            print(f"[更新节点] 设置前事件为空列表（首贞）")
        else:
            # 非首贞：有前事件
            update_node_data['previous_ids'] = previous_ids_list
            print(f"[更新节点] 设置前事件为: {previous_ids_list}")
        
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
        
        # 如果node_id改变了，需要更新所有子事件的previous_id
        if old_node_id != new_node_id:
            # 更新当前事件
            db.update_node(old_node_id, update_node_data)
            
            # 更新所有子事件的previous_id
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
            updated_node['owner_id'] = updated_node.get('owner_id') or owner_id
            
            await broadcast_node('node_updated', updated_node, access.owner_id, access)

        # 同步/清理副本（场主写主副本后，防自己副本遮蔽新主事实）
        if previous_ids is not None:
            serial_id = original_node.get('serial_id')
            if access.role == "owner":
                # 场主自己修改，清空自己这行的连线记录（回退到活跃表）
                db.clear_user_override(access.actor_id, [serial_id])
            elif access.role == "admin":
                # admin代主修改，清理被代理场主的副本行，防遮蔽
                master_actor = access.master_actor_id
                if master_actor:
                    db.clear_user_override(master_actor, [serial_id])
        
        return {
            "status": "success",
            "message": message,
            "scope": "master",
            "owner_id": owner_id,
            "actor_id": access.actor_id,
            "access": access.to_public()
        }
    
    except Exception as e:
        print(f"[API 错误] 事件更新失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 历史数据接口：获取所有活跃事件 ---
@app.get("/api/v1/causal/history")
async def get_causal_history(request: Request, actor_id: str = None, owner_id: str = None, bot_id: str = None):
    """
    职责：返回所有活跃事件数据，用于前端初始化显示。
    支持参数：
        actor_id: 用户ID（URL 观测者身份；若带有效 token，以 token 身份为准）
        owner_id: 事件拥有者ID，如果提供则只返回该拥有者的事件
        bot_id: 机器人ID，如果提供则额外合并异场中属于该 bot 的 [chat] 节点
    鉴权：
        - 场主 / admin：可见全部节点（含 is_share=false）
        - 观测者 / 匿名：仅可见 is_share=true；异场私密节点只留打码桩点
        - 观测者首次访问时自动建立用户副本（复制主副本权重与 parent_id）
    """
    try:
        # 如果没有提供owner_id，使用默认值'default'
        if owner_id is None:
            owner_id = 'default'

        access = resolve_access(request=request, owner_id=owner_id, actor_id=actor_id)
        viewer = access.actor_id  # token 身份优先；无 token 时为 URL actor_id 或 None

        # 获取指定owner_id的节点数据
        active_nodes = db.get_all_active(owner_id)

        # 追加合并跨场接触面节点（是否可见由后续统一过滤决定）
        if viewer:
            cross_nodes = db.get_cross_field_contact_surface(owner_id=owner_id, actor_id=viewer, owner_actor=access.master_actor_id)
            existing_ids = {n['node_id'] for n in active_nodes}
            for n in cross_nodes:
                if n['node_id'] not in existing_ids:
                    active_nodes.append(n)
                    existing_ids.add(n['node_id'])

        # 追加合并 bot 专属 chat 节点（跨 owner_id 场）
        if viewer and bot_id:
            bot_nodes = db.get_bot_chat_nodes_cross_field(bot_id, exclude_owner_id=owner_id)
            for n in bot_nodes:
                if n['node_id'] not in existing_ids:
                    active_nodes.append(n)
                    existing_ids.add(n['node_id'])
            print(f"[bot合并] 纳入 bot({bot_id}) 的异场 chat 节点 {len(bot_nodes)} 个")

        # 可见性过滤（观测者/匿名只保留 is_share=true 的节点；异场私密节点打码）
        active_nodes = sanitize_nodes(active_nodes, access)

        # 观测者/场主：首次访问自动建立用户副本（复制场主副本/主副本权重与 parent_id）
        if viewer:
            owner_actor = access.master_actor_id
            # 批量建副本：一次 SELECT + 一次 executemany，避免 N 次数据库往返阻塞事件循环
            copy_targets = [n for n in active_nodes if not n.get('is_locked')]
            if copy_targets:
                db.ensure_user_copies_bulk(viewer, copy_targets, owner_actor=owner_actor)

            # 一次性应用三级回退（权重和连线）
            actors_to_fetch = [viewer]
            if owner_actor and owner_actor != viewer:
                actors_to_fetch.append(owner_actor)
                
            serial_ids = [n['serial_id'] for n in active_nodes if n.get('serial_id')]
            if serial_ids:
                overrides = db.get_user_overrides_multi(actors_to_fetch, serial_ids)
                my_ovs = overrides.get(viewer, {})
                owner_ovs = overrides.get(owner_actor, {}) if owner_actor else {}
                
                for node in active_nodes:
                    if node.get('is_locked'):
                        continue
                    sid = node.get('serial_id')
                    if not sid:
                        continue
                    
                    my_ov = my_ovs.get(sid)
                    owner_ov = owner_ovs.get(sid)
                    
                    # 权重回退
                    if my_ov and my_ov['weight'] is not None:
                        node['survival_weight'] = my_ov['weight']
                    elif owner_ov and owner_ov['weight'] is not None:
                        node['survival_weight'] = owner_ov['weight']
                        
                    # 连线回退
                    effective_parent = node.get('previous_node') # In active_nodes this might be parent_id or previous_node, but get_all_active usually sets previous_node. Wait, get_all_active maps parent_id to previous_node ? Let's just use what's in the dict. But the node from get_all_active might have previous_ids computed. Let's trace back.
                    
                    if my_ov and my_ov['has_parent']:
                        effective_parent = my_ov['parent_id']
                    elif owner_ov and owner_ov['has_parent']:
                        effective_parent = owner_ov['parent_id']
                        
                    if effective_parent is not None: # Note that we must also convert to previous_ids
                        node['previous_ids'] = db._string_to_previous(effective_parent)

        # 转换数据格式以兼容 JSON 传输
        for node in active_nodes:
            node['last_accessed'] = str(node['last_accessed'])
            node['created_at'] = str(node['created_at'])
            node['survival_weight'] = float(node['survival_weight'])

        # 只保留可见节点的语义连线
        visible_ids = {n['node_id'] for n in active_nodes}
        semantic_links = [
            link for link in db.get_all_semantic_links(owner_id=owner_id, threshold=0.6)
            if link['source'] in visible_ids and link['target'] in visible_ids
        ]

        # 检查是否存在大股东节点（权重 >= 0.59），如果有则计算事件视界
        boss_node_id = None
        event_horizon_ids = None
        if viewer:
            for node in active_nodes:
                if float(node.get('survival_weight', 0)) >= 0.59:
                    boss_node_id = node.get('node_id')
                    break

            if boss_node_id:
                # 动态读取 .env 文件中的 MAX_EYES 配置
                import os
                env_config = {}
                env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
                if os.path.exists(env_path):
                    with open(env_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith('#') and '=' in line:
                                key, val = line.split('=', 1)
                                # 移除注释部分
                                if '#' in val:
                                    val = val.split('#')[0]
                                env_config[key.strip()] = val.strip().strip('"').strip("'")
                try:
                    max_eyes = float(env_config.get("MAX_EYES", 30))
                except ValueError:
                    max_eyes = 30.0

                event_horizon_nodes = db.get_event_horizon(boss_node_id, max_eyes, owner_id, actor_id=viewer, owner_actor=access.master_actor_id)
                # 视界也遵守可见性
                event_horizon_ids = [
                    n['node_id'] for n in event_horizon_nodes if n.get('node_id') in visible_ids
                ]
                print(f"[页面初始化] 检测到大股东节点 {boss_node_id} (用户: {viewer}, owner: {owner_id})，视界半径: {max_eyes}，视界内节点数: {len(event_horizon_ids)}")

        return {
            "status": "success",
            "data": active_nodes,
            "semantic_links": semantic_links,
            "actor_id": viewer,
            "owner_id": owner_id,
            "access": access.to_public(),
            "boss_node_id": boss_node_id,
            "event_horizon": event_horizon_ids,
            "current_max_eyes": USER_MAX_EYES_CACHE.get(f"{viewer}_{owner_id}") if viewer else None
        }
    
    except Exception as e:
        print(f"[API 错误] 获取历史数据失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 搜索接口：关键字搜索 ---
@app.api_route("/api/v1/causal/search/keyword", methods=["GET", "POST"])
async def search_by_keyword(request: Request):
    """
    职责：根据关键字搜索事件节点
    支持参数：
        keyword: 搜索关键词，支持逻辑与（&）操作符
        owner_id: 事件拥有者ID，如果为None则搜索所有事件
        limit: 返回结果数量限制，如果为None则返回所有行
    """
    try:
        if request.method == "POST":
            try:
                search_data = await request.json()
            except Exception:
                search_data = {}
        else:
            search_data = dict(request.query_params)

        keyword = search_data.get('keyword')
        owner_id = search_data.get('owner_id', 'default')
        bot_id = search_data.get('bot_id')
        
        limit_val = search_data.get('limit', 100)
        try:
            limit = int(limit_val) if limit_val is not None else None
        except ValueError:
            limit = 100
        
        if not keyword:
            return {"status": "error", "message": "缺少搜索关键词"}

        # 鉴权：观测者/匿名只能搜到 is_share=true 的节点
        access = resolve_access(request=request, data=search_data, owner_id=owner_id,
                                actor_id=search_data.get('actor_id'))
        
        # 导入搜索模块
        from core.search import get_event_with_params
        
        # 执行搜索
        results = get_event_with_params(keyword, owner_id, limit, bot_id)

        # 可见性过滤：用节点快照判定 is_share（非场主只能看到共享节点）
        if not access.can_read_private:
            share_map = {n['node_id']: n.get('is_share') for n in db.get_all_active(owner_id)}
            results = [
                r for r in results
                if is_shared({'is_share': share_map.get(r.get("本事件标题"), True)})
            ]
        
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
                "previous_ids": result.get("前事件ID列表", []) or [],
                "next_ids": result.get("后续事件ID列表", []) or [],
                "search_mode": "keyword"  # 标识为关键字搜索，帮助 Agent 理解相似度基于 V5 字面匹配算法
            }
        
            converted_results.append(converted)
        
        return {
            "status": "success",
            "data": converted_results,
            "count": len(converted_results),
            "owner_id": owner_id,
            "access": access.to_public()
        }
    except Exception as e:
        print(f"[API 错误] 关键字搜索失败: {e}")
        return {"status": "error", "message": str(e)}


# --- 搜索接口：向量搜索 ---
@app.post("/api/v1/causal/search/vector")
async def search_by_vector(search_data: dict, request: Request):
    """
    职责：根据关键字的语义向量搜索事件节点
    支持参数：
        keyword: 搜索关键词（自然语言描述）
        owner_id: 事件拥有者ID，如果为None则搜索所有事件
        limit: 返回结果数量限制，如果为None则返回所有行
        threshold: 余弦相似度阈值（0-1），过滤低相似度结果。不传则沿用「望远镜」口径：
                   threshold = 1 - MAX_EYES/100（.env 中 MAX_EYES=40 → 0.6，30 → 0.7）；
                   显式传 0 表示不过滤
    鉴权：场主/admin 可搜到全部节点；观测者/匿名只能搜到 is_share=true 的节点
    """
    try:
        keyword = search_data.get('keyword')
        owner_id = search_data.get('owner_id', 'default')
        bot_id = search_data.get('bot_id')
        limit = search_data.get('limit', 100)

        # threshold 与 max_eyes 是同一门槛的两种刻度：threshold = 1 - max_eyes/100
        # 未显式指定时沿用「望远镜」口径（.env 的 MAX_EYES），使检索视野与事件视界一致
        raw_threshold = search_data.get('threshold')
        try:
            threshold = float(raw_threshold) if raw_threshold not in (None, '') else None
        except (TypeError, ValueError):
            threshold = None
        if threshold is None:
            threshold = max(0.0, 1 - _env_max_eyes() / 100.0)
        
        if not keyword:
            return {"status": "error", "message": "缺少搜索关键词"}
        
        # 鉴权：token 身份优先于 URL/body 中的 actor_id
        access = resolve_access(request=request, data=search_data, owner_id=owner_id,
                                actor_id=search_data.get('actor_id'))

        # 导入搜索模块
        from core.search import get_event_with_vector

        # 执行搜索
        results = get_event_with_vector(keyword, owner_id, limit, bot_id)

        # 可见性过滤：用节点快照判定 is_share（非场主只能看到共享节点，与关键字搜索一致）
        if not access.can_read_private:
            share_map = {n['node_id']: n.get('is_share') for n in db.get_all_active(owner_id)}
            results = [
                r for r in results
                if is_shared({'is_share': share_map.get(r.get("本事件标题"), True)})
            ]
        
        # 将中文键名转换为英文键名，以便与前端保持一致
        converted_results = []
        for result in results:
            similarity = result.get("vector_similarity") or 0

            # 过滤低于阈值的低相似度结果（threshold <= 0 表示不过滤）
            if threshold > 0 and similarity < threshold:
                continue
                
            converted = {
                "serial_id": result.get("本事件ID"),
                "node_id": result.get("本事件标题"),
                "event_tuple": result.get("事件二元组描述"),
                "survival_weight": result.get("本事件权重"),
                "block_tag": result.get("因缘标签"),
                "action_tag": result.get("动作标签"),
                "full_image_url": result.get("截图"),
                "owner_id": result.get("事件拥有者"),
                "previous_ids": result.get("前事件ID列表", []) or [],
                "next_ids": result.get("后续事件ID列表", []) or [],
                "relevance_score": result.get("本事件相关度", 0),
                "vector_similarity": similarity,
                "search_mode": "vector"  # 标识为向量搜索，帮助 Agent 理解相似度基于语义空间
            }
        
            converted_results.append(converted)
            
        return {
            "status": "success",
            "data": converted_results,
            "count": len(converted_results),
            "keyword": keyword,
            "threshold": threshold,
            "access": access.to_public()
        }
    
    except Exception as e:
        print(f"[API 错误] 向量搜索失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 搜索接口：序列ID搜索 ---

@app.post("/api/v1/causal/search/serial")
async def search_by_serial(search_data: dict, request: Request):
    """
    职责：根据序列ID搜索事件节点
    支持参数：
        serial_id: 事件的物理序列ID
        actor_id: 用户ID（可选），如果提供则返回用户个性化权重
    鉴权：非场主/非 admin 不得读取 is_share=false 的节点
    """
    try:
        serial_id = search_data.get('serial_id')
        owner_id = search_data.get('owner_id') or 'default'

        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}

        # 鉴权：token 身份优先于 URL actor_id
        access = resolve_access(request=request, data=search_data, owner_id=owner_id,
                                actor_id=search_data.get('actor_id'))
        actor_id = access.actor_id
        
        # 导入搜索模块
        from core.search import get_event_by_sid
        
        # 执行搜索（传递actor_id以获取用户个性化权重与副本连线）
        result = get_event_by_sid(serial_id, actor_id=actor_id)
        
        if not result:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点"}

        # 可见性校验：非场主/非 admin 不得读取私密节点（旧数据缺省视为共享）
        if not access.can_read_private and not is_shared({'is_share': result.get('is_share')}):
            return {"status": "error", "message": "该事件为场主私有，无权访问"}
        
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
            "is_share": result.get("is_share"),
            "previous_ids": result.get("前事件ID列表", []) or [],
            "next_ids": result.get("后续事件ID列表", []) or [],
            "actor_id": actor_id if actor_id else None  # 添加actor_id字段
        }
    
        
        return {
            "status": "success",
            "data": [converted_result],
            "actor_id": actor_id,
            "access": access.to_public()
        }
    
    except Exception as e:
        print(f"[API 错误] 序列ID搜索失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 点击事件接口（同时支持 GET 和 POST）---
@app.api_route("/api/v1/causal/click", methods=["GET", "POST"])
async def handle_node_click(request: Request):
    """
    职责：处理节点点击事件（同时支持 GET 和 POST 请求）
    支持参数：
        serial_id: 事件节点的物理ID
        actor_id: 用户ID（可选）
        owner_id: 事件拥有者ID（可选）
        max_eyes: 望远镜功率/事件视界半径（可选）
        bot_id: 机器人ID（可选），提供则并入该 bot 跨场的 [chat] 记忆节点（过往）
    请求方式：
        - POST: 参数通过 JSON body 传递（原有方式，供 Agent/前端 JS 调用）
        - GET: 参数通过 URL query string 传递（便于直接用浏览器/curl 访问）
    Action:
        1. 从地宫恢复内容（如果存在）
        2. 提升节点权重到60%（大股东模式）
        3. 重新计算其他节点权重
        4. 通过socketio更新到前端
    """
    try:
        # 根据请求方法提取参数，统一存入 click_data 字典
        if request.method == "GET":
            click_data = dict(request.query_params)
            # query_params 返回字符串，需做类型转换
            if 'serial_id' in click_data:
                try:
                    click_data['serial_id'] = int(click_data['serial_id'])
                except (ValueError, TypeError):
                    pass
            if 'max_eyes' in click_data:
                try:
                    click_data['max_eyes'] = float(click_data['max_eyes'])
                except (ValueError, TypeError):
                    pass
        else:
            click_data = await request.json()

        serial_id = click_data.get('serial_id')
        req_owner_id = click_data.get('owner_id') or 'default'
        bot_id = click_data.get('bot_id')
        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}

        # 鉴权：token 身份优先于 URL 中的 actor_id
        access = resolve_access(request=request, data=click_data, owner_id=req_owner_id,
                                actor_id=click_data.get('actor_id'))
        actor_id = access.actor_id
        # 观测者只在有身份（token 或 URL actor_id）时才写副本、才做个性化权重
        can_observe = bool(actor_id)

        # 1. 通过serial_id获取节点信息（传递actor_id以获取用户个性化权重）
        from core.search import get_event_by_sid
        search_result = get_event_by_sid(serial_id, actor_id=actor_id)
        if not search_result:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点"}

        node_owner = search_result.get("事件拥有者") or req_owner_id
        node_share = search_result.get("is_share")
        # 本场私密节点：非场主/非 admin 不可见（旧数据无 is_share 时按共享处理）
        if node_owner == req_owner_id and not node_visible(
            {"owner_id": node_owner, "is_share": node_share}, access
        ):
            return {"status": "error", "message": "该事件为场主私有，无权访问"}
        
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
            "previous_ids": search_result.get("前事件ID列表", []) or [],
            "next_ids": search_result.get("后续事件ID列表", []) or []
        }
    
        
        node_id = node.get('node_id')
        
        # owner_id 用于权重分配（优先使用请求中的，回退到节点自身的）
        owner_id = click_data.get('owner_id')
        if not owner_id:
            owner_id = node.get('owner_id', 'default')
        
        # focal_owner_id：焦点节点自身的场，用于异场接触面（防止跨 owner 污染）
        # 注意：事件视界扫描（get_event_horizon）改用 owner_id（当前视角场），
        # 与 /history 页面初始化保持一致——否则点击异场节点时视界会落在焦点自身场，
        # 导致当前视角场的节点永远不在视界内、max_eyes 滑杆失效。
        focal_owner_id = node.get('owner_id', owner_id)
            
        print(f"[点击事件] 开始处理 serial_id: {serial_id}, actor_id: {actor_id}, bot_id: {bot_id}, owner_id: {owner_id}, focal_owner_id: {focal_owner_id}")
        print(f"[点击事件] 找到节点: {node_id} (serial_id: {serial_id})")
        
        # 2. 从地宫恢复内容（只有场主/admin 才允许写回主副本）
        restored_node = None
        if access.can_write_master:
            restored_node = db.restore_from_necropolis(node_id)
            if restored_node:
                print(f"[点击事件] 已从地宫恢复节点 {node_id} 的完整内容")
                node = restored_node
                # 剥离语义/视觉向量，避免浪费 LLM token
                node.pop('semantic_vector', None)
                node.pop('visual_vector', None)
        else:
            # 观测者：只读地宫全文用于展示，不写回主副本
            necropolis_row = db.get_necropolis_content_readonly(node_id, search_result.get("serial_id"))
            if necropolis_row and necropolis_row.get("raw_content"):
                node['event_tuple'] = necropolis_row['raw_content']
                if necropolis_row.get("raw_full_image_url"):
                    node['full_image_url'] = necropolis_row['raw_full_image_url']
        
        # 2.5 计算事件视界 (Event Horizon)
        # 动态读取 .env 文件，无需重启服务器即可生效
        from dotenv import dotenv_values
        env_config = dotenv_values(".env")
        
        # 优先使用请求中传入的 max_eyes，如果为 None 则回退到 .env 中的配置
        req_max_eyes = click_data.get('max_eyes')
        if req_max_eyes is not None:
            try:
                max_eyes = float(req_max_eyes)
                # 缓存用户设置的 max_eyes，绑定 actor_id 和 owner_id
                if actor_id:
                    cache_key = f"{actor_id}_{owner_id}"
                    USER_MAX_EYES_CACHE[cache_key] = max_eyes
            except (ValueError, TypeError):
                max_eyes = float(env_config.get("MAX_EYES", 30))
        else:
            max_eyes = float(env_config.get("MAX_EYES", 30))
            
        horizon_show_links = env_config.get("HORIZON_DETAIL", "0") == "1"
        
        event_horizon_nodes = db.get_event_horizon(node_id, max_eyes, owner_id, show_links=horizon_show_links, actor_id=actor_id, owner_actor=access.master_actor_id)
        # 可见性过滤：观测者/匿名看不到场主私有节点（异场私密节点打码）
        event_horizon_nodes = sanitize_nodes(event_horizon_nodes, access)
        visible_horizon_ids = {n['node_id'] for n in event_horizon_nodes}
        
        # 增加异场接触面（并计算到焦点节点的真实距离）
        extra_nodes = []
        if actor_id:
            cross_nodes = db.get_cross_field_contact_surface(owner_id=focal_owner_id, actor_id=actor_id, focal_node_id=node_id, owner_actor=access.master_actor_id)
            cross_nodes = sanitize_nodes(cross_nodes, access)
            existing_horizon_ids = {n['node_id'] for n in event_horizon_nodes}
            for cn in cross_nodes:
                if cn['node_id'] not in existing_horizon_ids:
                    event_horizon_nodes.append(cn)
                    visible_horizon_ids.add(cn['node_id'])
                    extra_nodes.append(cn)

        # 增加 bot 专属 chat 节点（跨 owner_id 场，过往：记忆）
        if bot_id:
            # 注意：用 owner_id（当前视角场）而非 focal_owner_id（焦点节点自身场）排除。
            # 否则点击异场节点时，它所在场的其它 bot chat 节点会被一并排除、无法参与权重重排。
            bot_nodes = db.get_bot_chat_nodes_cross_field(bot_id, exclude_owner_id=owner_id, focal_node_id=node_id, max_eyes=max_eyes)
            bot_nodes = sanitize_nodes(bot_nodes, access)
            existing_horizon_ids = {n['node_id'] for n in event_horizon_nodes}
            for n in bot_nodes:
                n['last_accessed'] = str(n['last_accessed'])
                n['created_at'] = str(n['created_at'])
                n['survival_weight'] = float(n['survival_weight'])
                # 所有异场 bot chat 节点都要参与权重重排（即使它们已在视界显示集合里）
                extra_nodes.append(n)
                # 显示集合只追加尚未出现的节点，避免重复
                if n['node_id'] not in existing_horizon_ids:
                    event_horizon_nodes.append(n)
                    existing_horizon_ids.add(n['node_id'])
                    visible_horizon_ids.add(n['node_id'])
            print(f"[点击事件] 纳入 bot({bot_id}) 的异场 chat 节点 {len(bot_nodes)} 个（参与重排）")
                    
        event_horizon_ids = [n['node_id'] for n in event_horizon_nodes]
        print(f"[点击事件] 视界扫描完成，半径: {max_eyes}，视界内节点数: {len(event_horizon_ids)}，extra_nodes(异场并入重排): {len(extra_nodes)}")
        for en in extra_nodes:
            print(f"[点击事件]   extra_node: node_id={en.get('node_id')}, owner_id={en.get('owner_id')}, serial_id={en.get('serial_id')}, weight={en.get('survival_weight')}")
        
        # 打印视界内节点的实际距离，帮助调试
        if event_horizon_nodes:
            print(f"[点击事件] 视界内节点距离详情:")
            for i, n in enumerate(event_horizon_nodes[:10]): # 最多打印前10个
                print(f"  - {i+1}. {n['node_id']}: 距离 = {n.get('distance', '未知'):.4f}")

        # 3. 提升节点权重（大股东模式：60%）
        if can_observe:
            updated_nodes = db.promote_all_weights(
                node_id=node_id,
                actor_id=actor_id,
                owner_id=owner_id,
                set_as_boss=True,  # 设置为大股东模式
                extra_nodes=extra_nodes
            )
        else:
            # 匿名访问：无用户副本可写，直接返回视界（纯浏览）
            node['previous_ids'] = db.get_node_links(node_id, actor_id=None, owner_actor=access.master_actor_id).get('previous_ids', [])
            node['next_ids'] = db.get_node_links(node_id, actor_id=None, owner_actor=access.master_actor_id).get('next_ids', [])
            return {
                "status": "success",
                "message": f"节点 {node_id} 信息已获取（匿名浏览，不写入权重）",
                "data": node,
                "updated_count": 0,
                "actor_id": None,
                "owner_id": owner_id,
                "access": access.to_public(),
                "event_horizon": event_horizon_ids,
                "event_horizon_details": event_horizon_nodes
            }
        
        if not updated_nodes:
            print(f"[点击事件] 警告：权重提升未返回任何更新节点")
            # 即使没有更新节点，也返回当前节点信息
            return {
                "status": "success",
                "message": f"节点 {node_id} 信息已获取",
                "data": node,
                "updated_count": 0,
                "event_horizon": event_horizon_ids,
                "event_horizon_details": event_horizon_nodes
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
        
        # 4.5 注入因果链 serial_id 列表（多因多果）
        # 覆盖 get_node_by_id 返回的标题列表，改为 serial_id 整数列表（副本为宗）
        node_links = db.get_node_links(node_id, actor_id=actor_id, owner_actor=access.master_actor_id)
        current_node['previous_ids'] = node_links.get('previous_ids', [])
        current_node['next_ids'] = node_links.get('next_ids', [])
        print(f"[点击事件] 因果链: previous_ids={current_node['previous_ids']}, next_ids={current_node['next_ids']}")
        
        # 5. 广播所有更新的事件
        # 【去重】promote_all_weights 可能返回重复 node_id（跨场并入 / 大股东补充查询），
        # 同一节点重复广播会被前端重复处理，是显存与卡顿的放大器之一。按 node_id 去重后
        # 再以 nodes_updated 批量推送一次，node_updated 保留兼容（单节点场景仍可用）。
        _broadcast_seen = set()
        _broadcast_batch = []
        for updated_node in updated_nodes:
            # 剥离语义/视觉向量，避免浪费 LLM token 和 WebSocket 带宽
            updated_node.pop('semantic_vector', None)
            updated_node.pop('visual_vector', None)
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
            if 'previous_ids' not in updated_node and 'previous_ids' in current_node:
                updated_node['previous_ids'] = current_node['previous_ids']
            # 同步 previous_ids（内部字段）
            if 'previous_ids' not in updated_node and 'previous_ids' in current_node:
                updated_node['previous_ids'] = current_node['previous_ids']
            
            # 如果指定了actor_id，添加用户标识
            if actor_id:
                updated_node['actor_id'] = actor_id
            
            # 添加owner_id标识
            updated_node['owner_id'] = node_owner if updated_node.get('owner_id') in (None, '') else updated_node['owner_id']

            # 添加调试日志
            print(f"[点击事件广播] 节点 {updated_node.get('node_id')} 权重: {updated_node.get('survival_weight')}, 类型: {type(updated_node.get('survival_weight'))}")

            # 去重后暂存，循环结束后批量推送
            _nid = updated_node.get('node_id')
            if _nid and _nid in _broadcast_seen:
                print(f"[点击事件广播] 跳过重复节点 {_nid}")
                continue
            if _nid:
                _broadcast_seen.add(_nid)
            _broadcast_batch.append(updated_node)

        # 隔离广播：私密节点只发到「焦点场主」房间，共享节点发本场公共房间
        # 逐条发送（保持每个节点各自的可见性判定），但同一 node_id 只发一次
        for updated_node in _broadcast_batch:
            await broadcast_node('node_updated', updated_node, access.owner_id, access)
        if len(_broadcast_batch) > 1:
            # 兼容批量事件：前端可一次性处理，减少 WS 帧数与重复渲染
            await emit_nodes_updated_batch(_broadcast_batch, access.owner_id, access)

        # 如果显式传递了 max_eyes，则广播 horizon_updated 事件
        if req_max_eyes is not None:
            horizon_data = {
                "boss_node_id": node_id,
                "max_eyes": max_eyes,
                "event_horizon": event_horizon_ids,
                "actor_id": actor_id,
                "owner_id": owner_id
            }
        
            await emit_to_actor('horizon_updated', horizon_data, actor_id, access.owner_id)
            print(f"[点击事件] 广播 horizon_updated: max_eyes={max_eyes}, 视界节点数={len(event_horizon_ids)}")
            
        print(f"[点击事件] 完成处理，更新了 {len(updated_nodes)} 个节点")
        
        return {
            "status": "success",
            "message": f"节点 {node_id} 权重已提升到60%（大股东模式）",
            "data": current_node,
            "updated_count": len(updated_nodes),
            "actor_id": actor_id,
            "owner_id": owner_id,
            "access": access.to_public(),
            "event_horizon": event_horizon_ids,
            "event_horizon_details": event_horizon_nodes
        }
    
    except Exception as e:
        print(f"[API 错误] 点击事件处理失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 获取当前事件视界接口（同时支持 GET 和 POST）---
@app.api_route("/api/v1/causal/horizon", methods=["GET", "POST"])
async def get_current_event_horizon(request: Request):
    """
    职责：获取当前观测者在指定因果场中的事件视界。
    系统自动找到当前大股东节点（最高 survival_weight 事件），并以该节点为中心，
    返回语义距离 <= MAX_EYES 的光锥截面内的所有相关事件。
    注意：不同 actor_id 在同一 owner_id 的因果场中的大股东节点可能不同——
    这是因果场的参考系依赖效应。

    支持参数：
        actor_id: 用户ID（可选），用于个性化权重更新
        owner_id: 事件拥有者ID（可选，默认 'default'）
        max_eyes: 望远镜功率/事件视界半径（可选）
        bot_id: 机器人ID（可选），提供则并入该 bot 跨场的 [chat] 记忆节点（当下）

    请求方式：
        - POST: 参数通过 JSON body 传递（供 Agent/前端 JS 调用）
        - GET: 参数通过 URL query string 传递（便于直接用浏览器/curl 访问）

    返回:
        - status: success / error
        - data: 大股东节点全息内容（含 serial_id, node_id, event_tuple, previous_ids, next_ids 等）
        - event_horizon: 视界内节点ID列表
        - event_horizon_details: 视界内节点详情列表（含 distance）
        - updated_count: 权重更新节点数
        - actor_id: 观测者ID
        - owner_id: 因果场拥有者ID
        - max_eyes: 实际使用的视界半径

    示例:

    # 1. curl POST 示例
    curl -X POST http://127.0.0.1:8094/api/v1/causal/horizon \
      -H "Content-Type: application/json" \
      -d '{"actor_id":"415135222","owner_id":"222302526","max_eyes":40}'

    # 2. curl GET 示例
    curl "http://127.0.0.1:8094/api/v1/causal/horizon?actor_id=415135222&owner_id=222302526&max_eyes=40"

    # 3. 浏览器直接访问
    http://127.0.0.1:8094/api/v1/causal/horizon?actor_id=415135222&owner_id=222302526
    """
    try:
        # 根据请求方法提取参数
        if request.method == "GET":
            req_data = dict(request.query_params)
            if 'max_eyes' in req_data:
                try:
                    req_data['max_eyes'] = float(req_data['max_eyes'])
                except (ValueError, TypeError):
                    pass
        else:
            req_data = await request.json()

        actor_id = req_data.get('actor_id')
        owner_id = req_data.get('owner_id', 'default')
        req_max_eyes = req_data.get('max_eyes')
        bot_id = req_data.get('bot_id')

        # 1. 获取指定 owner_id 的活跃事件（复用 history 逻辑）
        access = resolve_access(request=request, data=req_data, owner_id=owner_id, actor_id=actor_id)
        actor_id = access.actor_id
        active_nodes = sanitize_nodes(db.get_all_active(owner_id), access)

        # 2. 如果指定了 actor_id，应用用户个性化权重（首次访问自动建立用户副本，三级回退）
        if actor_id:
            owner_actor = access.master_actor_id
            # 批量建副本，避免逐节点数据库往返
            if active_nodes:
                db.ensure_user_copies_bulk(actor_id, active_nodes, owner_actor=owner_actor)
            actors_to_fetch = [actor_id]
            if owner_actor and owner_actor != actor_id:
                actors_to_fetch.append(owner_actor)
            sids = [n['serial_id'] for n in active_nodes if n.get('serial_id')]
            if sids:
                ovs = db.get_user_overrides_multi(actors_to_fetch, sids)
                for node in active_nodes:
                    sid = node.get('serial_id')
                    if not sid: continue
                    my_ov = ovs.get(actor_id, {}).get(sid)
                    owner_ov = ovs.get(owner_actor, {}).get(sid) if owner_actor else None
                    if my_ov and my_ov['weight'] is not None:
                        node['survival_weight'] = my_ov['weight']
                    elif owner_ov and owner_ov['weight'] is not None:
                        node['survival_weight'] = owner_ov['weight']

        if not active_nodes:
            return {"status": "error", "message": f"owner_id {owner_id} 的因果星空中还没有事件"}

        # 3. 查找大股东节点（权重 >= 0.59）
        boss_node_id = None
        boss_serial_id = None
        for node in active_nodes:
            if float(node.get('survival_weight', 0)) >= 0.59:
                boss_node_id = node.get('node_id')
                boss_serial_id = node.get('serial_id')
                break

        if not boss_node_id:
            return {
                "status": "error", 
                "message": f"该 actor_id ({actor_id}) 尚未对 owner_id ({owner_id}) 的因果星空实施观测，未找到大股东节点"
            }
        

        # 4. 处理 max_eyes（优先请求参数，其次缓存，最后 .env 默认值）
        from dotenv import dotenv_values
        env_config = dotenv_values(".env")

        if req_max_eyes is not None:
            try:
                max_eyes = float(req_max_eyes)
                if actor_id:
                    cache_key = f"{actor_id}_{owner_id}"
                    USER_MAX_EYES_CACHE[cache_key] = max_eyes
            except (ValueError, TypeError):
                max_eyes = float(env_config.get("MAX_EYES", 30))
        else:
            cache_key = f"{actor_id}_{owner_id}" if actor_id else None
            cached_max_eyes = USER_MAX_EYES_CACHE.get(cache_key) if cache_key else None
            if cached_max_eyes is not None:
                max_eyes = cached_max_eyes
            else:
                max_eyes = float(env_config.get("MAX_EYES", 30))

        print(f"[事件视界] 大股东节点: {boss_node_id} (serial_id: {boss_serial_id}), actor_id: {actor_id}, owner_id: {owner_id}, max_eyes: {max_eyes}")

        # 5. 通过 serial_id 获取节点详细信息（复用 click 接口逻辑）
        from core.search import get_event_by_sid
        search_result = get_event_by_sid(boss_serial_id, actor_id=actor_id)
        if not search_result:
            return {"status": "error", "message": f"找不到 serial_id 为 {boss_serial_id} 的节点"}

        node = {
            "serial_id": search_result.get("本事件ID"),
            "node_id": search_result.get("本事件标题"),
            "event_tuple": search_result.get("事件二元组描述"),
            "survival_weight": search_result.get("本事件权重"),
            "block_tag": search_result.get("因缘标签"),
            "action_tag": search_result.get("动作标签"),
            "full_image_url": search_result.get("截图"),
            "owner_id": search_result.get("事件拥有者"),
            "previous_ids": search_result.get("前事件ID列表", []) or [],
            "next_ids": search_result.get("后续事件ID列表", []) or []
        }
    
        node_id = node.get('node_id')
        focal_owner_id = node.get('owner_id', owner_id)

        # 6. 从地宫恢复内容（只有场主/admin 才允许写回主副本）
        restored_node = None
        if access.can_write_master:
            restored_node = db.restore_from_necropolis(node_id)
            if restored_node:
                print(f"[事件视界] 已从地宫恢复节点 {node_id} 的完整内容")
                node = restored_node
                node.pop('semantic_vector', None)
                node.pop('visual_vector', None)
        else:
            necropolis_row = db.get_necropolis_content_readonly(node_id, search_result.get("serial_id"))
            if necropolis_row and necropolis_row.get("raw_content"):
                node['event_tuple'] = necropolis_row['raw_content']
                if necropolis_row.get("raw_full_image_url"):
                    node['full_image_url'] = necropolis_row['raw_full_image_url']

        # 7. 计算事件视界（观测者的因果连线以用户副本为宗）
        horizon_show_links = env_config.get("HORIZON_DETAIL", "0") == "1"
        event_horizon_nodes = db.get_event_horizon(node_id, max_eyes, owner_id, show_links=horizon_show_links, actor_id=actor_id, owner_actor=access.master_actor_id)
        event_horizon_nodes = sanitize_nodes(event_horizon_nodes, access)

        # 7.1 追加合并 bot 专属 chat 节点（跨 owner_id 场，当下：记忆）
        extra_nodes = []
        if bot_id:
            bot_nodes = db.get_bot_chat_nodes_cross_field(bot_id, exclude_owner_id=focal_owner_id, focal_node_id=node_id, max_eyes=max_eyes)
            bot_nodes = sanitize_nodes(bot_nodes, access)
            existing_horizon_ids = {n['node_id'] for n in event_horizon_nodes}
            for n in bot_nodes:
                if n['node_id'] not in existing_horizon_ids:
                    n['last_accessed'] = str(n['last_accessed'])
                    n['created_at'] = str(n['created_at'])
                    n['survival_weight'] = float(n['survival_weight'])
                    event_horizon_nodes.append(n)
                    extra_nodes.append(n)
            print(f"[事件视界] 纳入 bot({bot_id}) 的异场 chat 节点 {len(bot_nodes)} 个")

        event_horizon_ids = [n['node_id'] for n in event_horizon_nodes]
        print(f"[事件视界] 扫描完成，半径: {max_eyes}，视界内节点数: {len(event_horizon_ids)}")

        # 8. 提升节点权重到 60%（大股东模式）
        if actor_id:
            updated_nodes = db.promote_all_weights(
                node_id=node_id,
                actor_id=actor_id,
                owner_id=owner_id,
                set_as_boss=True,
                extra_nodes=extra_nodes
            )
        else:
            updated_nodes = []

        # 9. 从更新节点中找到当前节点
        current_node = None
        for updated_node in updated_nodes:
            if updated_node.get('node_id') == node_id:
                current_node = updated_node
                break
        if not current_node:
            current_node = node

        # 10. 注入因果链 serial_id 列表（副本为宗）
        node_links = db.get_node_links(node_id, actor_id=actor_id, owner_actor=access.master_actor_id)
        current_node['previous_ids'] = node_links.get('previous_ids', [])
        current_node['next_ids'] = node_links.get('next_ids', [])

        # 11. 广播所有更新的事件（按可见性分房间）
        # 【去重】同一 node_id 只广播一次，避免前端重复处理导致显存与卡顿放大
        _hz_seen = set()
        _hz_batch = []
        for updated_node in updated_nodes:
            updated_node.pop('semantic_vector', None)
            updated_node.pop('visual_vector', None)
            if 'survival_weight' in updated_node:
                updated_node['survival_weight'] = float(updated_node['survival_weight'])
            if 'last_accessed' in updated_node:
                updated_node['last_accessed'] = str(updated_node['last_accessed'])
            if 'created_at' in updated_node:
                updated_node['created_at'] = str(updated_node['created_at'])
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
            if 'previous_ids' not in updated_node and 'previous_ids' in current_node:
                updated_node['previous_ids'] = current_node['previous_ids']
            if actor_id:
                updated_node['actor_id'] = actor_id

            _nid = updated_node.get('node_id')
            if _nid and _nid in _hz_seen:
                continue
            if _nid:
                _hz_seen.add(_nid)
            _hz_batch.append(updated_node)

        for updated_node in _hz_batch:
            await broadcast_node('node_updated', updated_node, access.owner_id, access)
        if len(_hz_batch) > 1:
            await emit_nodes_updated_batch(_hz_batch, access.owner_id, access)

        # 12. 如果显式传递了 max_eyes，广播 horizon_updated 事件
        if req_max_eyes is not None:
            horizon_data = {
                "boss_node_id": node_id,
                "max_eyes": max_eyes,
                "event_horizon": event_horizon_ids,
                "actor_id": actor_id,
                "owner_id": owner_id
            }
        
            await emit_to_actor('horizon_updated', horizon_data, actor_id, access.owner_id)

        return {
            "status": "success",
            "message": f"当前大股东节点 {node_id} 的事件视界已获取",
            "data": current_node,
            "updated_count": len(updated_nodes),
            "actor_id": actor_id,
            "owner_id": owner_id,
            "access": access.to_public(),
            "max_eyes": max_eyes,
            "event_horizon": event_horizon_ids,
            "event_horizon_details": event_horizon_nodes
        }
    

    except Exception as e:
        print(f"[API 错误] 获取事件视界失败: {e}")
        return {"status": "error", "message": str(e)}



# --- 因果链骨架接口 ---
@app.post("/api/v1/causal/skeleton")
async def get_causal_skeleton(skeleton_data: dict, request: Request):
    """
    职责：获取事件的因果链全息图骨架
    支持参数：
        serial_id: 事件的物理序列ID（必需）
        actor_id: 用户ID（可选），如果提供则返回用户个性化权重与副本连线
    """
    try:
        serial_id = skeleton_data.get('serial_id')
        access = resolve_access(request=request, data=skeleton_data,
                                owner_id=skeleton_data.get('owner_id') or 'default',
                                actor_id=skeleton_data.get('actor_id'))
        actor_id = access.actor_id
        
        if serial_id is None:
            return {"status": "error", "message": "缺少序列ID"}
        
        # 导入搜索模块
        from core.search import get_event_skeleton
        
        # 执行因果链骨架查询（副本为宗）
        skeleton = get_event_skeleton(serial_id, actor_id=actor_id)

        if not skeleton:
            return {"status": "error", "message": f"找不到serial_id为{serial_id}的节点或因果链为空"}

        # 可见性过滤：骨架中剔除当前访问者不可见节点
        #   骨架可能跨场（因果连线跨 owner），因此按「本场 is_share」+「异场 is_share」两段判定。
        if not access.can_read_private:
            share_map = {}
            for n in db.get_all_active(access.owner_id):
                share_map[n['node_id']] = is_shared(n)
            # 异场节点：只放行 is_share=true 的
            for n in db.get_all_active(None):
                if n['node_id'] in share_map:
                    continue
                share_map[n['node_id']] = is_shared(n)

            skeleton = [
                n for n in skeleton
                if share_map.get(n.get('本事件标题'), False)
            ]
        
        return {
            "status": "success",
            "data": skeleton,
            "serial_id": serial_id,
            "actor_id": actor_id,
            "access": access.to_public(),
            "count": len(skeleton)
        }
    
    except Exception as e:
        print(f"[API 错误] 因果链骨架查询失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 核心接口：Genesis (首贞/又贞/对贞) ---
@app.post("/api/v1/causal/genesis")
async def create_genesis_node(node: CausalNodeRequest, request: Request):
    """
    职责：接收因果推演请求。
    逻辑：
    1. 如果指定 previous_node，必须验证其在数据库中是否存在（溯源）。
    2. 严格执行 INSERT， node_id 重复则报错（禁止覆盖）。
    3. 对于首贞（没有父节点），强制设置：previous_node=None, action_tag="贞", block_tag="因"
    鉴权：只有场主 / admin 可以录入主副本（观测者只读共享内容 + 写自己的副本）。
    """
    try:
        req_body = await request.json()
    except Exception:
        req_body = {}
    access = resolve_access(request=request, data=req_body, owner_id=node.owner_id, actor_id=None)
    if not access.can_write_master:
        return {
            "status": "error",
            "message": "仅场主或 admin 可以录入贞卜；观测者请先创建自己的场",
            "data": {"role": access.role},
        }
    # 主副本归属：以实际拥有该场的场主为准
    owner_id = access.owner_id
    
    # 处理父节点ID：可能是字符串、列表或|分隔的字符串
    previous_ids = []
    if node.previous_node is not None:
        if isinstance(node.previous_node, list):
            previous_ids = node.previous_node
        elif isinstance(node.previous_node, str):
            # 如果是|分隔的字符串，解析为列表
            if '|' in node.previous_node:
                previous_ids = [pid.strip() for pid in node.previous_node.split('|') if pid.strip()]
            else:
                previous_ids = [node.previous_node.strip()] if node.previous_node.strip() else []
    
    # 1. 因果溯源校验（支持多父节点）
    if previous_ids:
        # 验证所有父节点是否存在
        missing_parents = []
        for previous_id in previous_ids:
            parent = db.get_node_by_id(previous_id)
            if not parent:
                missing_parents.append(previous_id)
        
        if missing_parents:
            return {
                "status": "error", 
                "message": f"因果断裂：找不到父事件 {missing_parents}，请先录入前贞。"
            }
        
    
    # 2. 确定是否为首贞（没有父节点）
    is_first_node = not previous_ids
    
    # 3. 构造新事件字典
    new_node = {
        "node_id": node.node_id,
        "event_tuple": node.event_tuple,
        "survival_weight": 1.0,
        "full_image_url": node.full_image_url,
        "is_share": node.is_share,
        "owner_id": owner_id
      }

    
    # 设置父节点
    if is_first_node:
        # 首贞：没有父节点
        new_node["previous_node"] = None
    else:
        # 非首贞：有父节点
        new_node["previous_node"] = previous_ids
    
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
        broadcast_payload = new_node.copy()
        # 确保survival_weight是float类型
        if 'survival_weight' in broadcast_payload:
            broadcast_payload['survival_weight'] = float(broadcast_payload['survival_weight'])
        
        await broadcast_node('node_created', broadcast_payload, owner_id, access)
        print(f"[AINS] {new_node['action_tag']} 录入成功: {node.node_id}")
        
        # 6. 根据配置决定是否返回 serial_id
        response_data = {"node_id": node.node_id}
        
        # 优先使用请求参数，如果未提供则使用环境变量
        if node.return_serial_id is not None:
            return_serial_id = node.return_serial_id
        else:
            return_serial_id = os.getenv("RETURN_SERIAL_ID_ON_GENESIS", "False").lower() == "true"
            
        if return_serial_id:
            inserted_node = db.get_node_by_id(node.node_id)
            if inserted_node and 'serial_id' in inserted_node:
                response_data["serial_id"] = inserted_node['serial_id']
                
        return {"status": "success", "data": response_data}
    
    except Exception as e:
        error_msg = str(e)
        if "already exists" in error_msg:
            return {
                "status": "error", 
                "message": f"冲突：事件 ID '{node.node_id}' 已存在。历史不可覆盖，请为新动作指定唯一 ID。"
            }
        
        print(f"[API 错误] {error_msg}")
        return {"status": "error", "message": error_msg}

# --- Socket.IO 房间隔离工具 ---
# 房间约定：
#   field:{owner_id}:public   —— 该场的共享（is_share=true）事件广播
#   field:{owner_id}:private  —— 该场的私密事件广播（只有场主 / admin 在前端订阅）
#   actor:{actor_id}          —— 某个观察者的个人广播（权重等个性化更新）

def public_room(owner_id: str) -> str:
    return f"field:{owner_id or 'default'}:public"


def private_room(owner_id: str) -> str:
    return f"field:{owner_id or 'default'}:private"


def actor_room(actor_id: str) -> str:
    return f"actor:{actor_id}"


async def emit_nodes_updated_batch(nodes: list, field_owner_id: str, access=None):
    """
    职责：把一批已更新的节点用单条 nodes_updated 事件推送出去。

    与 broadcast_node 的区别：broadcast_node 逐节点发送并独立判定可见性，
    本函数只负责"把已通过可见性判定的那批节点打包成一条帧"，
    房间集合与 broadcast_node 完全一致（public/private 焦点场 + 视角场公共房间），
    因此不改变任何可见性语义（Memory.md §7 的 owner+actor 过滤仍由调用方保证）。

    客户端收到 nodes_updated 后一次性批量更新，避免 N 条 WS 帧引发的重复渲染。
    """
    if not nodes:
        return

    # 按"该批次里是否存在共享节点"决定房间集合：
    # 私密节点只能进焦点场主房间，不能因为同批里有共享节点而泄漏到公共房间。
    private_nodes = [n for n in nodes if not bool(n.get('is_share'))]
    shared_nodes = [n for n in nodes if bool(n.get('is_share'))]

    if private_nodes:
        owner_ids = {n.get('owner_id') or field_owner_id for n in private_nodes}
        for oid in owner_ids:
            batch = [n for n in private_nodes if (n.get('owner_id') or field_owner_id) == oid]
            await sm.emit('nodes_updated', batch, room=private_room(oid))

    if shared_nodes:
        # 与 broadcast_node 保持完全一致：本场 public + private + 视角场 public
        rooms = {public_room(field_owner_id), private_room(field_owner_id)}
        for n in shared_nodes:
            onid = n.get('owner_id') or field_owner_id
            rooms.add(public_room(onid))
            rooms.add(private_room(onid))
        for room in rooms:
            await sm.emit('nodes_updated', shared_nodes, room=room)


async def broadcast_node(event: str, node: dict, field_owner_id: str, access=None):
    """
    职责：按节点可见性把节点事件广播到合适的房间。
    私密节点 → 只发焦点场主的 private 房间；共享节点 → 发送到 field 的 public/private + actor 房间。
    """
    owner_id = node.get('owner_id') or field_owner_id
    is_share = bool(node.get('is_share'))

    if not is_share:
        await sm.emit(event, node, room=private_room(owner_id))
        return

    # 共享节点：本场公共房间必发；再按视角场的订阅情况补充
    rooms = {public_room(owner_id), private_room(owner_id)}
    rooms.add(public_room(field_owner_id))
    for room in rooms:
        await sm.emit(event, node, room=room)


async def emit_to_actor(event: str, payload: dict, actor_id, field_owner_id: str):
    """职责：个性化事件只发给对应观察者房间（无身份时退回本场公共房间）。"""
    if actor_id:
        await sm.emit(event, payload, room=actor_room(actor_id))
    else:
        await sm.emit(event, payload, room=public_room(field_owner_id))


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

    # 加入房间：本场公共房间；有身份再加个人房间（私密房间只在前端声明 owner 时加入）
    await sm.enter_room(sid, public_room(owner_id))
    if actor_id:
        await sm.enter_room(sid, actor_room(actor_id))
    if query_params.get('role') in ('owner', 'admin'):
        await sm.enter_room(sid, private_room(owner_id))

    # 【重要】这里不再把已有节点逐个 emit 成 node_created。
    # 首屏数据由前端主动拉取 /api/v1/causal/history（3d_main.js / 2d_main.js 初始化），
    # 而 node_created 在前端的语义是「拓扑新增」，会触发全量重绘。
    # 若在此按节点数逐个推送，一次连接就会引发 N 次 /history 全量重载，
    # 进而阻塞事件循环 → Socket.IO 心跳超时 → 自动重连 → 无限重绘。
    print(f"[Socket.IO连接] sid={sid} 已加入房间，首屏数据交由 /history 拉取")


# --- Socket 逻辑：声明身份（前端拿到 /auth/context 后调用，进入私密房间）---
@sm.on('auth_join')
async def handle_auth_join(sid, data):
    """
    职责：前端把服务端裁决后的角色回传，加入对应房间。
    只接受服务端返回过的角色值（owner/admin 才进 private 房间），防止伪造。
    """
    data = data or {}
    owner_id = (data.get('owner_id') or 'default')
    actor_id = data.get('actor_id')
    role = data.get('role')
    print(f"[Socket.IO房间] sid={sid}, owner_id={owner_id}, actor_id={actor_id}, role={role}")
    await sm.enter_room(sid, public_room(owner_id))
    if actor_id:
        await sm.enter_room(sid, actor_room(actor_id))
    if role in ('owner', 'admin'):
        await sm.enter_room(sid, private_room(owner_id))


# --- Socket 逻辑：巡航视觉同步（纯转发，不写数据库） ---
@sm.on('cruise_step')
async def handle_cruise_step(sid, data):
    """巡航跳跃：纯视觉广播，不做数据库写入"""
    print(f"[因果巡航广播] sid={sid}, node_id={data.get('node_id')}, actor_id={data.get('actor_id')}, owner_id={data.get('owner_id')}")
    await sm.emit('cruise_view', data)


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

@app.get("/api/v1/apimd/raw")
async def get_api_md_raw():
    """
    返回 API.md 文件内容（保持原始格式，供账号中心生成 API/SKILL 使用）
    """
    return read_file("API.md")

@app.get("/auth", response_class=HTMLResponse)
async def get_auth(request: Request):
    """账号中心页面"""
    return templates.TemplateResponse(request=request, name="auth.html")


@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    """首页系统简介"""
    return templates.TemplateResponse(request=request, name="index.html")


# --- 启动代谢引擎 ---
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(metabolism.run())
    print("[系统] 因果代谢引擎已激活。")



# --- 账号中心：注册 / 登录 / 修改密码 / 重置密码 ---

@app.post("/api/v1/auth/register")
async def auth_register(data: dict):
    """注册新 actor，并签发首把钥匙 token。"""
    actor_id = (data.get("actor_id") or "").strip()
    password = data.get("password") or ""
    if not actor_id or len(password) < 6:
        return {"status": "error", "message": "actor_id 必填，密码至少 6 位"}
    if db.get_user(actor_id):
        return {"status": "error", "message": "该 actor 已注册"}
    token = db._new_token(actor_id)
    try:
        db.create_user(actor_id, password, token)
    except Exception as e:
        return {"status": "error", "message": "注册失败: " + str(e)}
    return {"status": "success", "message": "注册成功，首把钥匙已签发", "data": {"token": token}}


@app.post("/api/v1/auth/login")
async def auth_login(data: dict):
    """登录：校验密码，返回名下全部钥匙 token 列表。"""
    actor_id = (data.get("actor_id") or "").strip()
    password = data.get("password") or ""
    user = db.get_user(actor_id)
    if not user:
        return {"status": "error", "message": "用户不存在"}
    if not db._verify_password(password, user.get("password")):
        return {"status": "error", "message": "密码错误"}
    tokens = db.get_user_tokens(actor_id)
    return {
        "status": "success",
        "message": "登录成功",
        "data": {"tokens": tokens, "token": tokens[0] if tokens else ""}
    }


@app.post("/api/v1/auth/password/change")
async def auth_change_password(data: dict):
    """修改密码：需校验旧密码。"""
    actor_id = (data.get("actor_id") or "").strip()
    old_password = data.get("old_password") or ""
    new_password = data.get("new_password") or ""
    user = db.get_user(actor_id)
    if not user:
        return {"status": "error", "message": "用户不存在"}
    if not db._verify_password(old_password, user.get("password")):
        return {"status": "error", "message": "旧密码错误"}
    if len(new_password) < 6:
        return {"status": "error", "message": "新密码至少 6 位"}
    db.update_user_password(actor_id, new_password)
    return {"status": "success", "message": "密码已修改"}


@app.post("/api/v1/auth/password/reset")
async def auth_reset_password(data: dict):
    """忘记密码重置：用名下任意一把有效钥匙 token 验证身份后重置。"""
    actor_id = (data.get("actor_id") or "").strip()
    token = (data.get("token") or "").strip()
    new_password = data.get("new_password") or ""
    user = db.get_user(actor_id)
    if not user:
        return {"status": "error", "message": "用户不存在"}
    if token not in db.get_user_tokens(actor_id):
        return {"status": "error", "message": "钥匙无效"}
    if len(new_password) < 6:
        return {"status": "error", "message": "新密码至少 6 位"}
    db.update_user_password(actor_id, new_password)
    return {"status": "success", "message": "密码已重置，请用新密码登录"}


# --- 账号中心：场管理 ---

def _require_self_or_admin(request: Request, actor_id: str, data: dict = None):
    """
    职责：/owner/*、/key/* 的操作者必须是该 actor 本人或 admin。
    要求携带有效 token（token 是账号中心的操作凭证），仅 URL actor_id 不足。
    返回 (access, error_dict)。
    """
    access = resolve_access(request=request, data=data, owner_id=(data or {}).get("owner_id", "default"))
    if not access.has_token:
        return access, {"status": "error", "message": "请先登录（需要有效钥匙 token）"}
    if access.actor_id != actor_id and not access.is_admin:
        return access, {"status": "error", "message": "无权操作他人的账号数据"}
    return access, None


@app.get("/api/v1/owner/list")
async def owner_list(actor_id: str, request: Request):
    """获取指定 actor 名下所有场（从 ains_owner_masters 读取）。"""
    if not actor_id:
        return {"status": "error", "message": "actor_id 必填"}
    _, err = _require_self_or_admin(request, actor_id)
    if err:
        return err
    owners = db.list_owners(actor_id)
    return {
        "status": "success",
        "data": [{
            "owner_id": o["owner_id"],
            "name": o["name"],
            "actor_id": o.get("actor_id"),
            "method": o.get("method"),
            "bot_id": o.get("bot_id"),
            "source_id": o.get("source_id"),
        } for o in owners],
    }


@app.post("/api/v1/owner/create")
async def owner_create(data: dict, request: Request):
    """创建场并成为主人；owner_id 由场类型、机器人与群/用户 ID 统一生成。"""
    name = (data.get("name") or "").strip()
    actor_id = (data.get("actor_id") or "").strip()
    method = (data.get("method") or "").strip().lower()
    bot_id = (data.get("bot_id") or "").strip()
    source_id = (data.get("source_id") or "").strip()
    if not name or not actor_id:
        return {"status": "error", "message": "场名称、actor_id 均必填"}
    if method not in ("private", "group"):
        return {"status": "error", "message": "类型必须是 private（私聊）或 group（群聊）"}
    if not bot_id:
        return {"status": "error", "message": "机器人 ID（bot_id）必填"}
    if method == "group" and not source_id:
        return {"status": "error", "message": "群聊场景必须填写群 ID（source_id）"}

    owner_id = f"{actor_id}_{bot_id}" if method == "private" else f"{source_id}_{bot_id}"
    _, err = _require_self_or_admin(request, actor_id, data)
    if err:
        return err
    # 一套房子只能有一个产权人：先查该场是否已有主人
    if db.owner_exists(owner_id):
        return {"status": "error", "message": "该场已经有了主人，请另外填写新场名"}
    try:
        db.create_owner(owner_id, name, actor_id, method=method, bot_id=bot_id,
                        source_id=source_id or None)
    except Exception as e:
        return {"status": "error", "message": "创建失败: " + str(e)}
    return {
        "status": "success",
        "message": "创建成功",
        "data": {"owner_id": owner_id, "name": name, "method": method,
                 "bot_id": bot_id, "source_id": source_id or None},
    }


@app.post("/api/v1/owner/update")
async def owner_update(data: dict, request: Request):
    """重命名场。"""
    owner_id = (data.get("owner_id") or "").strip()
    name = (data.get("name") or "").strip()
    actor_id = (data.get("actor_id") or "").strip()
    if not owner_id or not name or not actor_id:
        return {"status": "error", "message": "owner_id、name、actor_id 均必填"}
    _, err = _require_self_or_admin(request, actor_id, data)
    if err:
        return err
    db.rename_owner(owner_id, name, actor_id)
    return {"status": "success", "message": "已改名"}


@app.post("/api/v1/owner/delete")
async def owner_delete(data: dict, request: Request):
    """删除场（不删除该场的节点数据）。"""
    owner_id = (data.get("owner_id") or "").strip()
    actor_id = (data.get("actor_id") or "").strip()
    if not owner_id or not actor_id:
        return {"status": "error", "message": "owner_id、actor_id 均必填"}
    _, err = _require_self_or_admin(request, actor_id, data)
    if err:
        return err
    db.delete_owner(owner_id, actor_id)
    return {"status": "success", "message": "已删除（节点数据未删除）"}


@app.post("/api/v1/owner/delete_all")
async def owner_delete_all(data: dict, request: Request):
    """彻底删除场：活跃表 + 地宫表 + 用户权重表 + 场注册，并清除他场接触面爹引用。"""
    owner_id = (data.get("owner_id") or "").strip()
    actor_id = (data.get("actor_id") or "").strip()
    if not owner_id or not actor_id:
        return {"status": "error", "message": "owner_id、actor_id 均必填"}
    access, err = _require_self_or_admin(request, actor_id, data)
    if err:
        return err
    # 只有场主本人或 admin 可以彻底删除场
    if access.actor_id != actor_id and not access.is_admin:
        return {"status": "error", "message": "只有场主或 admin 可以彻底删除场"}
    try:
        result = db.delete_owner_all(owner_id)
    except Exception as e:
        print(f"[API 错误] 删除全部失败: {e}")
        return {"status": "error", "message": str(e)}

    # 广播 field_deleted（全局广播，前端按 owner_id/actor_id 隔离）
    await sm.emit('field_deleted', {
        "deleted_owner_id": owner_id,
        "affected_nodes": result.get("affected_nodes", []),
        "message": f"场 {owner_id} 已被删除，相关节点失去了与它的因果连线"
    })

    return {
        "status": "success",
        "message": f"已彻底删除场 {owner_id} 的全部事件节点",
        "data": result
    }


# --- 账号中心：钥匙 Token 管理 ---

@app.post("/api/v1/key/generate")
async def key_generate(data: dict, request: Request):
    """签发一把新钥匙 token（仅此一次返回明文）。"""
    actor_id = (data.get("actor_id") or "").strip()
    if not actor_id or not db.get_user(actor_id):
        return {"status": "error", "message": "请先登录"}
    _, err = _require_self_or_admin(request, actor_id, data)
    if err:
        return err
    token = db._new_token(actor_id)
    db.add_user_token(actor_id, token)
    return {"status": "success", "message": "钥匙已签发", "data": {"token": token}}


@app.get("/api/v1/key/list")
async def key_list(actor_id: str, request: Request):
    """获取名下所有钥匙 token 列表。"""
    if not actor_id:
        return {"status": "error", "message": "actor_id 必填"}
    _, err = _require_self_or_admin(request, actor_id)
    if err:
        return err
    return {"status": "success", "data": db.get_user_tokens(actor_id)}


@app.post("/api/v1/key/revoke")
async def key_revoke(data: dict, request: Request):
    """
    吊销一把钥匙 token。
    鉴权：auth_token（或 Authorization: Bearer）证明操作者身份；token 表示待吊销的钥匙。
    """
    actor_id = (data.get("actor_id") or "").strip()
    token = (data.get("token") or "").strip()
    if not actor_id or not token:
        return {"status": "error", "message": "actor_id、token 均必填"}
    access = resolve_access(request=request, data=data)
    if not access.actor_id:
        return {"status": "error", "message": "需要登录后再吊销钥匙"}
    if access.actor_id != actor_id and not access.is_admin:
        return {"status": "error", "message": "无权吊销他人的钥匙"}
    db.remove_user_token(actor_id, token)
    return {"status": "success", "message": "已吊销"}


# --- 鉴权上下文：供前端在页面加载时确认角色（observer / owner / admin）---

@app.get("/api/v1/auth/context")
async def auth_context(request: Request, owner_id: str = "default", actor_id: str = None):
    """
    职责：根据 token 与 URL 参数解析当前访问权限，返回角色矩阵。
    前端据此决定：是否显示抽屉、是否允许编辑、是否显示私有节点。
    """
    access = resolve_access(request=request, owner_id=owner_id, actor_id=actor_id)
    return {"status": "success", "data": access.to_public()}


@app.api_route("/api/v1/auth/token/verify", methods=["GET", "POST"])
async def auth_token_verify(request: Request):
    """职责：校验一把 token 是否有效，并返回其身份与是否为某场主人。"""
    if request.method == "POST":
        try:
            payload = await request.json()
        except Exception:
            payload = {}
    else:
        payload = dict(request.query_params)

    token = (payload.get("token") or "").strip()
    owner_id = (payload.get("owner_id") or "default").strip() or "default"
    if not token:
        return {"status": "error", "message": "缺少 token"}

    actor = db.get_actor_by_token(token)
    if not actor:
        return {"status": "error", "message": "钥匙无效", "data": {"valid": False}}

    master = db.get_owner_master(owner_id) or {}
    return {
        "status": "success",
        "data": {
            "valid": True,
            "actor_id": actor,
            "owner_id": owner_id,
            "is_owner": (master.get("actor_id") or "") == actor,
            "is_admin": db.is_admin_actor(actor),
        },
    }


@app.get("/api/v1/auth/me")
async def auth_me(request: Request):
    """职责：返回当前 token 对应的 actor 及其名下场（用于账号中心）。"""
    access = resolve_access(request=request)
    if not access.has_token or not access.actor_id:
        return {"status": "error", "message": "未登录或钥匙无效"}
    fields = db.list_user_fields(access.actor_id)
    return {
        "status": "success",
        "data": {
            "actor_id": access.actor_id,
            "is_admin": access.is_admin,
            "fields": [{"owner_id": f["owner_id"], "name": f["name"]} for f in fields],
        },
    }


# --- 管理端点（仅 admin 可调用）---

def _require_admin(request: Request, data: dict = None):
    """内部工具：解析请求并断言 admin 身份。返回 (access, error_dict)。"""
    access = resolve_access(request=request, data=data)
    if not access.is_admin:
        return access, {"status": "error", "message": "仅 admin 可调用该接口"}
    return access, None


@app.get("/api/v1/admin/actors")
async def admin_actors(request: Request, limit: int = 200, offset: int = 0):
    """职责：admin 列出全部 actor（不含密码）。"""
    _, err = _require_admin(request)
    if err:
        return err
    users = db.list_users(limit=limit, offset=offset)
    return {
        "status": "success",
        "data": [
            {
                "actor_id": u["actor_id"],
                "is_admin": bool(u.get("is_admin")),
                "created_at": str(u.get("created_at")),
            }
            for u in users
        ],
    }


@app.post("/api/v1/admin/actors/{actor_id}/admin")
async def admin_set_actor_admin(actor_id: str, request: Request):
    """职责：admin 设置/取消某 actor 的 admin 标记。body: {"is_admin": true}"""
    try:
        data = await request.json()
    except Exception:
        data = {}
    _, err = _require_admin(request, data)
    if err:
        return err
    if not db.get_user(actor_id):
        return {"status": "error", "message": "actor 不存在"}
    if is_builtin_admin(actor_id) and not bool(data.get("is_admin")):
        return {"status": "error", "message": f"内置管理员 {actor_id} 不可降权"}
    db.set_actor_admin(actor_id, bool(data.get("is_admin")))
    return {"status": "success", "message": "已更新", "data": {"actor_id": actor_id, "is_admin": bool(data.get("is_admin"))}}


@app.post("/api/v1/admin/actors/{actor_id}/delete")
async def admin_delete_actor(actor_id: str, request: Request):
    """
    职责：admin 注销 actor，级联删除其名下场与全部用户副本。
    保护：不能删除自己；不能删除最后一个 admin。
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    access, err = _require_admin(request, data)
    if err:
        return err
    if access.actor_id == actor_id:
        return {"status": "error", "message": "不能删除自己"}
    if is_builtin_admin(actor_id):
        return {"status": "error", "message": f"内置管理员 {actor_id} 不可注销"}
    if db.is_admin_actor(actor_id) and db.count_admins() <= 1:
        return {"status": "error", "message": "不能删除最后一个 admin"}
    owners = db.delete_actor_cascade(actor_id)
    print(f"[admin] {access.actor_id} delete-actor {actor_id} (fields={owners})")
    return {"status": "success", "message": f"已注销 {actor_id}", "data": {"deleted_fields": owners}}


@app.get("/api/v1/admin/owners")
async def admin_owners(request: Request, limit: int = 500):
    """
    职责：admin 房主管理面板的数据源——按「房主」聚合。
    返回：房主 actor、名下场清单（含节点数）、钥匙数、admin 标记。
    """
    _, err = _require_admin(request)
    if err:
        return err
    owners = db.list_owner_actors(limit=limit)
    return {"status": "success", "data": owners, "count": len(owners)}


@app.post("/api/v1/admin/actors/{actor_id}/token/reset")
async def admin_reset_actor_token(actor_id: str, request: Request):
    """
    职责：admin 为某房主重置钥匙——吊销其全部旧钥匙并签发一把新钥匙。
    返回：新钥匙明文（仅此一次）+ 被吊销把数。
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    access, err = _require_admin(request, data)
    if err:
        return err
    if not db.get_user(actor_id):
        return {"status": "error", "message": "actor 不存在"}
    result = db.reset_actor_tokens(actor_id)
    print(f"[admin] {access.actor_id} reset-token {actor_id} (revoked={result['revoked_count']})")
    return {
        "status": "success",
        "message": f"已重置 {actor_id} 的钥匙，旧钥匙全部失效",
        "data": result,
    }


@app.get("/api/v1/admin/actors/{actor_id}")
async def admin_actor_detail(actor_id: str, request: Request):
    """
    职责：admin 查看某个 actor 的详情（名下所有场、钥匙、admin 状态）。
    返回的首把钥匙 token 用于“以该 actor 身份进入星空”。
    """
    _, err = _require_admin(request)
    if err:
        return err
    user = db.get_user(actor_id)
    if not user:
        return {"status": "error", "message": "actor 不存在"}
    tokens = db.get_user_tokens(actor_id)
    fields = db.list_user_fields(actor_id)
    return {
        "status": "success",
        "data": {
            "actor_id": actor_id,
            "is_admin": bool(user.get("is_admin")),
            "created_at": str(user.get("created_at")),
            "first_token": tokens[0] if tokens else "",
            "token_count": len(tokens),
            "fields": [
                {"owner_id": f["owner_id"], "name": f["name"]} for f in fields
            ],
        },
    }


@app.get("/api/v1/admin/fields")
async def admin_fields(request: Request, limit: int = 500):
    """职责：admin 列出全部场及其节点数。"""
    _, err = _require_admin(request)
    if err:
        return err
    fields = db.list_all_fields(limit=limit)
    return {
        "status": "success",
        "data": [
            {
                "owner_id": f["owner_id"],
                "name": f["name"],
                "actor_id": f["actor_id"],
                "node_count": int(f.get("node_count") or 0),
            }
            for f in fields
        ],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8094)
