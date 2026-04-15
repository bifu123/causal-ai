# 因果AI系统 - 安装使用说明

## 系统概述
因果AI系统是一个基于因果关系的知识管理和可视化平台，支持3D和2D视图展示因果链关系。系统包含代谢引擎，自动管理节点权重和生命周期。

## 安装步骤

### 1. 克隆代码库
```bash
git -c http.sslVerify=false clone https://github.com/bifu123/causal-ai
cd causal-ai
```

### 2. 创建虚拟环境
```bash
python3 -m venv .causal_ai
source ./.causal_ai/bin/activate
```

### 3. 安装依赖
```bash
pip install -r requirements.txt
```


### 4. 环境变量配置

在 `.env` 文件中配置以下环境变量：

```env
# 数据库配置
DB_HOST=localhost
DB_DATABASE=causal_ai_db
DB_USER=postgres
DB_PASSWORD=your_password
DB_PORT=5432

# 代谢引擎配置
EVENT_MAX=4000      # 最大字符总数
EVENT_LOSS=3000     # 超时时间（秒）
```

## 数据库配置

### PostgreSQL 16 中文分词插件 zhparser 安装

```bash
# 1. 环境准备
# 确保系统已安装 PostgreSQL 16 及其开发包（编译扩展必选）。

sudo apt-get update
sudo apt-get install postgresql-server-dev-16 build-essential git

# 2. 安装 SCWS (基础分词引擎)
# SCWS 是 zhparser 依赖的底层中文分词库。
# 进入工作目录
cd ~/causal_ai

# 下载并解压 SCWS
wget -q -O - [http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2](http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2) | tar xvj
cd scws-1.2.3

# 编译与安装
./configure
make
sudo make install

# 刷新系统库链接，确保能找到 libscws
sudo ldconfig

# 3. 安装 zhparser 扩展
# 回到工作目录并下载 zhparser 源码包
cd ~/causal_ai
wget [https://github.com/amutu/zhparser/archive/refs/tags/v2.3.tar.gz](https://github.com/amutu/zhparser/archive/refs/tags/v2.3.tar.gz) -O zhparser.tar.gz
tar -zxvf zhparser.tar.gz
cd zhparser-2.3

# 执行编译与物理安装
make
sudo make install
```

# 4. 应用扩展
```sql
-- 1. 激活扩展
CREATE EXTENSION IF NOT EXISTS zhparser;

-- 2. 创建全文检索配置 'chinese'
CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);

-- 3. 设置分词映射：将名词(n)、动词(v)、形容词(a)等映射为 simple 字典
ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
```


# 在PostgreSQL中运行./sql/中的各个文件，创建数据表
```

## 运行程序

### 启动服务
```bash
python main.py
```

服务默认运行在端口8094。

## 浏览器访问

### 3D视图
`
http://serverip:8094/3d?owner_id=worker&actor_id=user2
`

### 2D视图
`
http://serverip:8094/ui?owner_id=worker&actor_id=user2
`

### 查询参数说明
- `owner_id`: 节点拥有者ID，用于过滤显示特定用户的节点
- `actor_id`: 用户ID，用于显示用户特定的权重



## 核心功能API

### 事件管理API
- `POST /api/v1/causal/genesis`: 创建事件节点（首贞/又贞/对贞）
- `POST /api/v1/causal/update`: 更新事件节点信息
- `POST /api/v1/causal/delete`: 删除事件节点
- `GET /api/v1/causal/history`: 获取所有活跃事件数据

### 搜索API
- `POST /api/v1/causal/search/keyword`: 根据关键字搜索事件节点
- `POST /api/v1/causal/search/serial`: 根据序列ID搜索事件节点（支持actor_id参数）

### 权重管理API
- `POST /api/v1/causal/promote_chain`: 提升节点权重到60%（大股东模式）
- `POST /api/v1/causal/click`: 处理节点点击事件（包含地宫恢复和权重提升）
- `POST /api/v1/causal/restore`: 从地宫恢复节点内容

### 文件上传API
- `POST /api/v1/causal/upload`: 上传图片文件

### 参数说明
- `actor_id`: 用户ID，用于用户个性化权重管理。当提供此参数时，系统会从`ains_user_weights`表获取用户特定的权重数据。
- `owner_id`: 事件拥有者ID，用于过滤显示特定用户的事件节点。
- `serial_id`: 事件物理ID，在数据库中是唯一标识，用于精确查找特定事件。

### 用户个性化权重
系统支持多用户环境下的个性化权重管理：
1. 每个用户对因果节点有独立的权重视图
2. 点击节点时只更新该用户在`ains_user_weights`表中的权重记录
3. 不同用户对同一节点可以有不同的权重值
4. 前端显示时，优先使用用户权重，如果用户权重不存在则使用全局权重

### 搜索功能增强
- `get_event_by_sid`函数已更新，支持`actor_id`参数，返回用户个性化权重数据
- 序列ID搜索接口现在支持`actor_id`参数，可以返回用户特定的权重
- 点击事件接口现在传递`actor_id`参数，确保权重提升操作更新用户权重表


## 开发说明

### 代码结构
```
causal_ai/
├── core/
│   ├── database.py      # 数据库操作
│   └── metabolism.py    # 代谢引擎
├── static/              # 静态资源
├── templates/           # HTML模板
├── main.py             # 主程序
└── requirements.txt    # 依赖列表
```

### 扩展功能
1. **自定义代谢规则**：修改 `core/metabolism.py` 中的 `_metabolic_tick` 方法
2. **新增节点字段**：更新数据库表结构和相关代码
3. **添加可视化效果**：修改前端JavaScript代码

## 版本规划

1.0 使用元龙相关度算法V5检索
1.1 使用向量检索,并用向量距离及用户意志注入操作更新前端，成为4维时空



## 技术支持
QQ群：222302526
