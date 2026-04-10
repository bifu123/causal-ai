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

### 代谢引擎API
- `GET /api/metabolism/status`: 获取代谢引擎状态
- `POST /api/metabolism/set_boss/:node_id`: 手动设置节点为大股东

### 节点管理API
- `GET /api/nodes`: 获取所有节点
- `POST /api/nodes`: 创建新节点
- `PUT /api/nodes/:node_id`: 更新节点
- `DELETE /api/nodes/:node_id`: 删除节点

### 权重管理API
- `GET /api/weights/:actor_id`: 获取用户权重
- `POST /api/weights/:actor_id/:node_id`: 设置用户权重


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
