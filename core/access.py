"""
职责：统一解析请求的访问身份与权限（匿名 / 观测者 / 场主 / admin），
      并提供节点可见性判定与脱敏工具。

角色判定规则（见 鉴权升级方案.txt）：
    1. token 有效时，token 反查出的 actor 优先于 URL 中的 actor_id（防冒名）。
    2. token 属于该 owner 场的主（ains_owner_masters.actor_id）→ 场主。
    3. ains_users.is_admin 为真，或在 ADMIN_ACTOR_IDS 中 → admin。
    4. 其余（URL 带 actor_id，或任意有效非场主 token）→ 观测者。
    5. 既无 token 也无 actor_id → 匿名观测者（只读共享内容）。

权限含义：
    can_read_private  是否可读本场私有（is_share=false）节点
    can_write_copy    是否可写自己的用户副本（权重 / parent_id）
    can_write_master  是否可写主副本（内容、标签、is_share、删除、创世等）
"""
import os

from core.database import db

# 单例判定缓存：避免每次请求都读 .env
_ADMIN_ENV_CACHE = None


# 内置管理员：这些 actor_id 永远视为 admin（需求：写死）
# 注意：仍要求请求携带有效 token，防止用 URL 参数冒充。
BUILTIN_ADMIN_ACTORS = {"admin"}


def _admin_actor_ids():
    """读取 .env 中 ADMIN_ACTOR_IDS（逗号分隔），带进程内缓存。"""
    global _ADMIN_ENV_CACHE
    if _ADMIN_ENV_CACHE is None:
        raw = os.getenv("ADMIN_ACTOR_IDS", "") or ""
        _ADMIN_ENV_CACHE = {x.strip() for x in raw.split(",") if x.strip()}
    return _ADMIN_ENV_CACHE


def is_builtin_admin(actor_id):
    """判断是否为写死的内置管理员（不可降权、不可注销）。"""
    return bool(actor_id and actor_id.strip() in BUILTIN_ADMIN_ACTORS)


class AccessInfo(dict):
    """权限描述对象：既是 dict（可直接塞进 JSON 响应），又支持属性访问。"""

    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError:
            raise AttributeError(item)

    def to_public(self):
        """返回给前端的精简结构（不含任何 token 明文）。"""
        return {
            "role": self["role"],
            "actor_id": self["actor_id"],
            "owner_id": self["owner_id"],
            "has_token": self["has_token"],
            "can_read_private": self["can_read_private"],
            "can_write_copy": self["can_write_copy"],
            "can_write_master": self["can_write_master"],
            "is_admin": self["is_admin"],
            "key_scope": self.get("key_scope"),
            "is_locked": self.get("is_locked", False),
        }


def resolve_access(request=None, data=None, owner_id=None, actor_id=None):
    """
    解析访问权限。

    参数：
        request:  FastAPI Request（可选），用于读取 header / query
        data:     请求体 dict（可选），token 兜底来源
        owner_id: 当前视角场（默认 'default'）
        actor_id: URL 中携带的 actor_id（观测者身份）

    返回：AccessInfo（dict 子类）
    """
    data = data if isinstance(data, dict) else {}
    query = {}
    if request is not None:
        try:
            query = dict(request.query_params)
        except Exception:
            query = {}

    token = (
        query.get("auth_token")
        or data.get("auth_token")
        or _bearer_token(request)
        or query.get("token")
        or data.get("token")
        or ""
    ).strip()

    url_actor_id = (actor_id or query.get("actor_id") or data.get("actor_id") or "")
    url_actor_id = str(url_actor_id).strip()
    owner_id = str(owner_id or query.get("owner_id") or data.get("owner_id") or "default").strip() or "default"

    token_actor = None
    token_valid = False
    field_key_owner = None
    if token:
        try:
            token_actor = db.get_actor_by_token(token)
        except Exception as e:
            print(f"[鉴权警告] 校验 token 失败: {e}")
            token_actor = None
        token_valid = bool(token_actor)
        if not token_valid:
            # 场级钥匙：一场一把，只开它绑定的那座场；不携带任何 actor 身份，
            # 因此永远不能通过账号管理类接口（那些接口另查 token_actor）。
            try:
                field_key_owner = db.get_owner_by_field_token(token)
            except Exception as e:
                print(f"[鉴权警告] 校验场级钥匙失败: {e}")
                field_key_owner = None
            # 场级锁：场上锁后场级钥匙整把失效（actor 级钥匙不受影响，场主永远进得去）
            if field_key_owner:
                try:
                    if db.is_field_locked(field_key_owner):
                        field_key_owner = None
                except Exception as e:
                    print(f"[鉴权警告] 查询场级锁失败: {e}")
            token_valid = bool(field_key_owner)

    # token 有效时，token 身份优先于 URL 参数（防止冒名）
    effective_actor = token_actor or url_actor_id or None

    # 【安全边界】只有「有效 token」才能成为场主 / admin；
    # URL 中的 actor_id 仅用于建立该观测者的用户副本（方案 §1.5 / §1.6）。
    is_admin = False
    if token_valid and token_actor:
        try:
            if (is_builtin_admin(token_actor)
                    or db.is_admin_actor(token_actor)
                    or token_actor in _admin_actor_ids()):
                is_admin = True
        except Exception as e:
            print(f"[鉴权警告] 判断 admin 失败: {e}")

    master = db.get_owner_master(owner_id) or {}
    master_actor = (master.get("actor_id") or "").strip()
    field_locked = bool(master.get("is_locked"))
    is_owner = bool(token_valid and token_actor and master_actor and token_actor == master_actor)
    # 场级钥匙命中本场 → 本场范围内等同于场主（但不获得 actor 身份，出本场无效）
    field_key_match = bool(field_key_owner and field_key_owner == owner_id)
    if field_key_match:
        is_owner = True

    if is_admin:
        role = "admin"
    elif is_owner:
        role = "owner"
    elif effective_actor:
        role = "observer"
    else:
        role = "anonymous"

    can_write_master = role in ("owner", "admin")
    can_read_private = can_write_master
    # 观测者（含 URL 只有 actor_id、无 token 的情况）可写自己的副本
    can_write_copy = bool(effective_actor)

    info = AccessInfo(
        role=role,
        actor_id=effective_actor,
        url_actor_id=url_actor_id or None,
        owner_id=owner_id,
        master_actor_id=master_actor or None,
        unclaimed_field=(not master_actor),
        has_token=token_valid,
        token_actor=token_actor,
        key_scope=("field" if field_key_owner else ("actor" if token_actor else None)),
        field_key_owner=field_key_owner,
        is_locked=field_locked,
        is_admin=is_admin,
        is_owner=is_owner,
        can_read_private=can_read_private,
        can_write_copy=can_write_copy,
        can_write_master=can_write_master,
    )
    return info


def _bearer_token(request):
    """从 Authorization: Bearer 头中提取 token。"""
    if request is None:
        return ""
    try:
        header = request.headers.get("authorization") or ""
    except Exception:
        return ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def is_shared(node):
    """
    判断节点是否对外场开放（is_share）。
    旧数据可能没有该字段（None），按历史行为视为共享，避免升级后内容突然全部不可见。
    """
    if not node:
        return False
    value = node.get("is_share")
    return True if value is None else bool(value)


def node_visible(node, access):
    """
    判断节点对当前访问者是否可见。

    规则：
        - 场主 / admin 可见全部；
        - 其余访问者（观测者 / 匿名）仅可见 is_share=true 的节点；
        - 异场节点同理（旧数据缺省视为共享）。
    """
    if not node:
        return False
    if access.can_read_private:
        return True
    return is_shared(node)


def mask_locked_node(node):
    """异场私密节点打码：保留桩点位置，隐藏内容与图片。"""
    node["event_tuple"] = "【私密桩点】内容不可见"
    node["full_image_url"] = None
    node["is_locked"] = True
    return node


def sanitize_nodes(nodes, access):
    """
    过滤节点列表：不可见节点直接剔除；可见但内容需打码的异场私密节点保留桩点。
    返回新的列表（不修改入参顺序）。
    """
    if not nodes:
        return []
    if access.can_read_private:
        return list(nodes)

    visible = []
    for node in nodes:
        if not node:
            continue
        node_owner = node.get("owner_id")
        if node_owner in (None, "", access.owner_id):
            if is_shared(node):
                visible.append(node)
        elif is_shared(node):
            visible.append(node)
        else:
            visible.append(mask_locked_node(dict(node)))
    return visible


def visible_node_id_set(nodes, access):
    """返回当前访问者可见节点 ID 集合（用于裁剪 previous_ids / next_ids）。"""
    return {n.get("node_id") for n in nodes if n and n.get("node_id")}