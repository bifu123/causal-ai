'''
# metabolism.py - 生命代谢引擎
职责：驱动因果事件的生命代谢循环

核心功能：
1. 定时执行代谢滴答，处理权重衰减、视觉降级与地宫封存
2. 基于事件的创建时间和访问历史计算权重，确保每个事件的权重唯一且合理分布
3. 识别大股东（最近被点击的节点）并分配权重
4. 根据权重分配字符长度，自动提炼过长的事件内容
5. 提供手动设置大股东的接口，加载地宫全文

版本：v1.0

- 本版只是简单地根据权重分配字符长度并截取，还未使用LLM对事件内容进行智能提炼。
- 本版只对字符记忆处理，未到图像进行渐忘处理。
未来版本将引入更智能的提炼算法（如调用LLM）和更复杂的权重计算逻辑，以实现更接近人类特点的记忆代谢机制。
'''

import asyncio
import time
import os
import math
from datetime import datetime, timezone
from decimal import Decimal, getcontext
from dotenv import load_dotenv
from core.database import db

# 设置Decimal精度为30位（支持18位小数+额外精度）
getcontext().prec = 30

# 加载环境变量
load_dotenv()

def calculate_precise_weight(create_time_ns, half_life_days=7):
    """
    根据纳秒级时间差计算精确权重
    
    :param create_time_ns: 记录创建时的纳秒时间戳 (int)
    :param half_life_days: 半衰期（经过多少天权重减半），默认7天
    :return: Decimal类型的高精度权重值
    """
    # 1. 获取当前纳秒时间戳
    now_ns = time.time_ns()
    
    # 2. 计算纳秒差值 (1秒 = 1,000,000,000纳秒)
    # 哪怕只差1纳秒，diff_ns 也会不同
    diff_ns = max(0, now_ns - create_time_ns)
    
    # 3. 将半衰期从“天”转换为“纳秒”
    half_life_ns = half_life_days * 24 * 3600 * 10**9
    
    # 4. 指数衰减公式: Weight = 0.5 ^ (t / HalfLife)
    # 使用math.pow计算高精度浮点数，然后转换为Decimal
    if diff_ns == 0:
        return Decimal('1.0')
    
    # 计算指数：t / HalfLife
    exponent = diff_ns / half_life_ns
    
    # 计算0.5的指数次方
    weight_float = math.pow(0.5, exponent)
    
    # 转换为Decimal
    weight = Decimal(str(weight_float))
    
    return weight

class MetabolismEngine:
    def __init__(self, socket_manager, decay_rate=0.03, tick_interval=5):
        """
        职责：驱动因果事件的生命代谢循环
        :param socket_manager: 用于实时广播代谢状态的 SocketManager 实例
        :param decay_rate: 每次滴答减少的生存权重 (λ) - 现在基于时间衰减
        :param tick_interval: 代谢频率（秒）
        """
        self.sm = socket_manager
        self.decay_rate = decay_rate
        self.tick_interval = tick_interval
        self.is_running = False
        self.event_max = int(os.getenv("EVENT_MAX", 4000))
        self.event_loss = int(os.getenv("EVENT_LOSS", 3000))  # 距上次访问时间（秒）大于此值，且权重为0，event_tuple为NULL

    async def run(self):
        """
        职责：启动异步代谢心脏
        """
        self.is_running = True
        print(f"[代谢引擎] 启动：λ={self.decay_rate}, 滴答间隔={self.tick_interval}s")
        
        while self.is_running:
            try:
                await self._metabolic_tick()
            except Exception as e:
                print(f"[代谢报错] {e}")
            await asyncio.sleep(self.tick_interval)

    async def _metabolic_tick(self):
        """
        职责：执行单次代谢滴答，处理权重衰减、视觉降级与地宫封存
        新的逻辑：
        1. 基于 last_accessed 时间计算权重衰减
        2. 检查是否需要根据权重分配字符长度
        3. 根据 EVENT_LOSS 决定是否将 event_tuple 设置为 null
        """
        # 1. 获取所有非初创节点（有连接关系的节点）
        # 初创节点定义：parent_id为NULL且没有子节点
        active_nodes = db.get_non_startup_nodes()
        
        # 如果没有活跃事件，直接返回
        if not active_nodes:
            return
        
        # 2. 计算总字符长度
        total_chars = 0
        
        for node in active_nodes:
            event_tuple = node.get('event_tuple')
            if event_tuple is not None:
                total_chars += len(event_tuple)
        
        # 输出总字符长度
        print(f"[代谢调试] 目前所有节点字符之和: {total_chars}")
        
        # 3. 识别大股东（最近被点击的节点）和其他节点
        boss_node_id = None
        boss_time_since_access = float('inf')  # 寻找时间最小的（最近被点击）
        
        # 先找出最近被点击的节点（5分钟内）
        for node in active_nodes:
            last_accessed = node.get('last_accessed')
            if last_accessed:
                try:
                    if isinstance(last_accessed, str):
                        last_accessed_dt = datetime.fromisoformat(last_accessed.replace('Z', '+00:00'))
                    else:
                        last_accessed_dt = last_accessed
                    
                    now = datetime.now(timezone.utc)
                    if last_accessed_dt.tzinfo is None:
                        last_accessed_dt = last_accessed_dt.replace(tzinfo=timezone.utc)
                    
                    time_since_last_access = (now - last_accessed_dt).total_seconds()
                    
                    # 5分钟内被点击的节点有资格成为大股东
                    if time_since_last_access < 300:
                        if time_since_last_access < boss_time_since_access:
                            boss_node_id = node['node_id']
                            boss_time_since_access = time_since_last_access
                except Exception as e:
                    print(f"[代谢警告] 解析 last_accessed 时间出错: {e}")
        
        # 4. 计算所有节点的功劳分数
        node_merits = {}
        total_merit = Decimal('0.0')
        
        for node in active_nodes:
            node_id = node['node_id']
            # 从数据库读取的权重可能是Decimal或float，统一转换为Decimal
            current_weight = Decimal(str(node['survival_weight'])) if node['survival_weight'] is not None else Decimal('1.0')
            last_accessed = node.get('last_accessed')
            created_at = node.get('created_at')
            
            # 计算距离上次访问的时间（秒）
            time_since_last_access = 0
            if last_accessed:
                try:
                    if isinstance(last_accessed, str):
                        last_accessed_dt = datetime.fromisoformat(last_accessed.replace('Z', '+00:00'))
                    else:
                        last_accessed_dt = last_accessed
                    
                    now = datetime.now(timezone.utc)
                    if last_accessed_dt.tzinfo is None:
                        last_accessed_dt = last_accessed_dt.replace(tzinfo=timezone.utc)
                    
                    time_since_last_access = (now - last_accessed_dt).total_seconds()
                except Exception as e:
                    print(f"[代谢警告] 解析 last_accessed 时间出错: {e}")
                    time_since_last_access = 0
            
            # 计算功劳分数（确保每个节点分数都不同）
            merit_score = Decimal('0.0')
            
            # 1. 创建时间功劳：基于纳秒级时间差计算精确权重
            if created_at:
                try:
                    if isinstance(created_at, str):
                        created_at_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    else:
                        created_at_dt = created_at
                    
                    # 将创建时间转换为纳秒时间戳
                    # 使用datetime的timestamp()获取秒数，然后转换为纳秒
                    created_timestamp = created_at_dt.timestamp()
                    created_ns = int(created_timestamp * 1_000_000_000)
                    
                    # 使用纳秒级时间差计算精确权重
                    precise_weight = calculate_precise_weight(created_ns, half_life_days=7)
                    
                    # 添加到功劳分数
                    merit_score += precise_weight
                except Exception as e:
                    print(f"[代谢警告] 计算创建时间功劳出错: {e}")
                    merit_score += Decimal('0.5')
            
            # 2. 访问历史功劳：基于纳秒级访问时间
            if last_accessed is not None:
                try:
                    if isinstance(last_accessed, str):
                        last_accessed_dt = datetime.fromisoformat(last_accessed.replace('Z', '+00:00'))
                    else:
                        last_accessed_dt = last_accessed
                    
                    # 将访问时间转换为纳秒时间戳
                    accessed_timestamp = last_accessed_dt.timestamp()
                    accessed_ns = int(accessed_timestamp * 1_000_000_000)
                    
                    # 使用纳秒级时间差计算访问权重（半衰期更短，1天）
                    access_weight = calculate_precise_weight(accessed_ns, half_life_days=1)
                    
                    # 访问时间因子：最近访问功劳高
                    # 使用访问权重作为基础，然后根据访问时间距离调整
                    now = datetime.now(timezone.utc)
                    access_seconds_ago = (now - last_accessed_dt).total_seconds()
                    
                    # 访问时间衰减因子
                    if access_seconds_ago < 3600:  # 1小时内
                        access_decay_factor = Decimal('1.0')
                    elif access_seconds_ago < 86400:  # 1天内
                        access_decay_factor = Decimal('0.8')
                    elif access_seconds_ago < self.event_loss:  # 在超时时间内
                        access_decay_factor = Decimal('0.5')
                    else:
                        access_decay_factor = Decimal('0.1')
                    
                    # 综合访问因子
                    access_bonus = access_weight * access_decay_factor
                    merit_score += access_bonus
                except Exception as e:
                    print(f"[代谢警告] 计算访问历史功劳出错: {e}")
            
            # 3. 节点唯一性因子：确保没有两个节点分数完全相同
            # 使用节点ID的哈希值和创建时间的组合
            unique_seed = f"{node_id}_{created_at}"
            unique_hash = hash(unique_seed) % 10000
            unique_factor = Decimal(str(unique_hash / 100000.0))  # 0到0.1之间
            
            merit_score += unique_factor
            
            # 4. 确保功劳分数为正数
            merit_score = max(Decimal('0.1'), merit_score)
            
            node_merits[node_id] = {
                'node': node,
                'merit': merit_score,
                'time_since_last_access': time_since_last_access,
                'event_tuple': node.get('event_tuple'),
                'current_weight': current_weight,
                'is_boss': (node_id == boss_node_id)
            }
            
            # 只累加小弟的功劳分数（大股东的功劳不参与剩余分配）
            if node_id != boss_node_id:
                total_merit += merit_score
        
        # 5. 分配权重：大股东60%，所有其他节点分40%（全局权重分配）
        # 5.1 识别大股东：权重接近0.6的节点或最近访问的节点
        boss_node_id = None
        
        # 首先检查是否有权重接近0.6的节点（可能是手动设置的大股东）
        for node_id, merit_data in node_merits.items():
            current_weight = merit_data['current_weight']
            if abs(current_weight - Decimal('0.60')) < Decimal('0.01'):
                boss_node_id = node_id
                print(f"[代谢] 检测到现有大股东节点: {node_id} (权重: {current_weight})")
                break
        
        # 如果没有检测到现有大股东，使用最近访问的节点
        if not boss_node_id:
            # 寻找最近访问的节点（5分钟内）
            min_access_time = float('inf')
            for node_id, merit_data in node_merits.items():
                time_since_last_access = merit_data['time_since_last_access']
                if time_since_last_access < 300 and time_since_last_access < min_access_time:
                    boss_node_id = node_id
                    min_access_time = time_since_last_access
        
        # 5.2 计算所有其他节点的当前总权重（排除大股东）
        other_nodes_total_weight = Decimal('0.0')
        for node_id, merit_data in node_merits.items():
            if node_id != boss_node_id:
                other_nodes_total_weight += merit_data['current_weight']
        
        # 5.3 分配权重
        for node_id, merit_data in node_merits.items():
            node = merit_data['node']
            event_tuple = merit_data['event_tuple']
            current_weight = merit_data['current_weight']
            time_since_last_access = merit_data['time_since_last_access']
            
            if node_id == boss_node_id and boss_node_id is not None:
                # 大股东：固定60%
                new_weight = Decimal('0.60')
                print(f"[代谢] 节点 {node_id} 是大股东，权重设为60%")
            else:
                # 所有其他节点：按现有权重比例分配剩余的40%
                if other_nodes_total_weight > Decimal('0.0'):
                    # 按现有权重比例分配40%
                    weight_ratio = current_weight / other_nodes_total_weight
                    new_weight = weight_ratio * Decimal('0.40')
                else:
                    # 如果所有其他节点权重都为0，平均分配40%
                    num_other_nodes = len(node_merits) - 1
                    new_weight = Decimal('0.40') / Decimal(str(num_other_nodes)) if num_other_nodes > 0 else Decimal('0.0')
            
            # 确保权重在合理范围内
            new_weight = max(Decimal('0.01'), new_weight)  # 最低1%
            new_weight = min(Decimal('0.99'), new_weight)  # 最高99%（大股东是60%）
            
            # 使用18位小数确保权重绝对唯一性
            # 加入基于节点ID的微小区分因子（更精细）
            node_hash = hash(node_id) % 1000000000  # 9位数，提供更多变化
            tiny_unique = Decimal(str(node_hash)) / Decimal('1000000000000000000')  # 0.000000000000000001到0.000000000999999999
            new_weight += tiny_unique
            
            # 四舍五入到18位小数，确保极高精度
            new_weight = new_weight.quantize(Decimal('0.000000000000000001'))
            
            # 6. 检查是否需要将权重归0并清空内容
            # 条件：权重极低（< 0.0001）且距离上次访问时间超过 EVENT_LOSS 秒
            # 根据用户要求：权重归0时，event_tuple = ""，full_image_url = ""
            if new_weight < Decimal('0.0001') and time_since_last_access > self.event_loss:
                print(f"[代谢] 事件长时间未访问且权重归0，清空内容: {node_id} (权重: {new_weight:.4f}, 未访问 {time_since_last_access:.0f} 秒 > {self.event_loss} 秒)")
                
                # 将权重设为0，event_tuple设为空字符串，full_image_url设为空字符串
                db.upsert_node({
                    **node,
                    "survival_weight": Decimal('0.0'),
                    "event_tuple": "",  # 空字符串而不是None
                    "full_image_url": "",  # 空字符串
                    "vision_level": 9
                })
                
                await self.sm.emit('node_updated', {
                    "node_id": node_id,
                    "survival_weight": 0.0,
                    "event_tuple": "",
                    "full_image_url": "",
                    "vision_level": 9
                })
                continue
            
            # 7. 检查是否需要提炼 event_tuple（字符长度超过分配长度）
            if event_tuple is not None:
                # 检查event_tuple的结尾是否包含"[已提炼]"，如果包含则直接返回，不进行地宫封存
                if event_tuple.endswith("[已提炼]"):
                    # 如果已经提炼过，只更新权重，不进行地宫封存
                    print(f"[代谢] event_tuple 已提炼，跳过地宫封存: {node_id}")
                    
                    # 只更新权重
                    if abs(current_weight - new_weight) > Decimal('0.0001'):
                        db.upsert_node({
                            **node,
                            "survival_weight": new_weight
                        })
                        
                        await self.sm.emit('node_updated', {
                            "node_id": node_id,
                            "survival_weight": new_weight
                        })
                    continue
                
                # 计算该事件根据权重应分配的字符长度
                # 使用归一化权重：new_weight 已经是百分比（0.01-1.0）
                # 所以分配的字符数 = 权重 * 总字符限额
                allocated_chars = int(float(new_weight) * self.event_max)
                
                # 调试输出：显示字符分配情况
                print(f"[代谢调试] 节点 {node_id}:")
                print(f"  - 权重: {new_weight:.18f}")
                print(f"  - 分配字符数: {allocated_chars} (权重 {float(new_weight):.4f} * 总限额 {self.event_max})")
                print(f"  - 当前字符数: {len(event_tuple)}")
                print(f"  - 是否需要提炼: {len(event_tuple) > allocated_chars and allocated_chars > 0}")
                print(f"  - 总字符限额: {self.event_max}")
                
                # 如果实际长度超过分配长度，需要提炼
                if len(event_tuple) > allocated_chars and allocated_chars > 0:
                    print(f"[代谢] event_tuple 超过分配长度，需要提炼: {node_id} (实际: {len(event_tuple)}, 分配: {allocated_chars}, 权重: {new_weight:.4f})")
                    
                    # 将原始 event_tuple 封存到地宫
                    db.seal_to_necropolis(node_id)
                    
                    print(f'[DEBUG] metabolism.py: 简化 event_tuple（在实际应用中，这里应该调用 LLM 提炼为事件二元组）')
                    print(f'[DEBUG] metabolism.py: 这里简化为截取前 allocated_chars 个字符')
                    simplified_tuple = event_tuple[:allocated_chars] + "[已提炼]" if len(event_tuple) > allocated_chars else event_tuple
                    
                    # 更新数据库
                    db.upsert_node({
                        **node,
                        "survival_weight": new_weight,
                        "event_tuple": simplified_tuple
                    })
                    
                    await self.sm.emit('node_updated', {
                        "node_id": node_id,
                        "survival_weight": new_weight,
                        "event_tuple": simplified_tuple[:100] + "[已提炼]" if len(simplified_tuple) > 100 else simplified_tuple
                    })
                    continue
            
            # 8. 常规代谢：更新权重
            if abs(current_weight - new_weight) > Decimal('0.0001'):  # 只有权重有显著变化时才更新
                db.upsert_node({
                    **node,
                    "survival_weight": new_weight
                })
                
                # 只广播权重变化，避免传输大量数据
                await self.sm.emit('node_updated', {
                    "node_id": node_id,
                    "survival_weight": new_weight
                })

    async def set_node_as_boss(self, node_id: str):
        """
        手动设置节点为大股东（权重60%），并加载地宫全文
        
        :param node_id: 要设置为大股东的节点ID
        """
        print(f"[代谢] 手动设置节点 {node_id} 为大股东（权重60%）")
        
        # 1. 获取节点信息
        node = db.get_node_by_id(node_id)
        if not node:
            print(f"[代谢错误] 节点 {node_id} 不存在")
            return False
        
        # 2. 将节点权重设置为60%
        new_weight = Decimal('0.60')
        
        # 3. 加载地宫全文（如果存在）
        # 首先尝试从地宫恢复完整内容
        restored_node = db.restore_from_necropolis(node_id)
        
        # 4. 更新数据库
        update_data = {
            "node_id": node_id,
            "survival_weight": new_weight,
            "vision_level": node.get('vision_level', 0)
        }
        
        # 如果从地宫恢复了内容，更新event_tuple
        if restored_node and restored_node.get('event_tuple'):
            update_data["event_tuple"] = restored_node['event_tuple']
            print(f"[代谢] 已从地宫加载完整内容，字符数: {len(restored_node['event_tuple'])}")
        
        # 使用upsert_node更新数据
        db.upsert_node(update_data)
        
        # 5. 手动更新last_accessed时间
        conn = db.conn
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE ains_active_nodes 
                SET last_accessed = CURRENT_TIMESTAMP
                WHERE node_id = %s
            """, (node_id,))
        
        # 6. 广播更新事件
        await self.sm.emit('node_updated', {
            "node_id": node_id,
            "survival_weight": float(new_weight),
            "event_tuple": update_data.get("event_tuple", node.get('event_tuple', ''))[:100] + "..." if update_data.get("event_tuple") else node.get('event_tuple', '')
        })
        
        print(f"[代谢] 节点 {node_id} 已设置为大股东，权重: 60%")
        return True

    def stop(self):
        self.is_running = False
        print("[代谢引擎] 停止。")
