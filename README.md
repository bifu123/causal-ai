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

在PostgreSQL中执行./sql/中的各个文件

## 运行程序

### 启动服务
```bash
python main.py
```

服务默认运行在端口8094。

## 浏览器访问

### 3D视图
```
http://serverip:8094/3d?owner_id=worker&actor_id=user2
```

### 2D视图
```
http://serverip:8094/ui?owner_id=worker&actor_id=user2
```

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

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查PostgreSQL服务是否运行
   - 验证数据库配置信息

2. **代谢引擎不工作**
   - 检查环境变量配置
   - 查看日志文件中的错误信息

3. **节点权重不更新**
   - 确认代谢引擎正在运行
   - 检查节点连接状态（初创节点不参与代谢）

### 日志查看
系统日志输出到控制台，包含以下信息：
- 数据库连接状态
- 代谢引擎运行状态
- 权重分配详情
- 错误和警告信息

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

## 版本更新

### 最新更新（2026-04-10）
- **修复代谢引擎排除初创节点逻辑**：使用连接状态而非权重值判断初创节点
- **优化数据库查询性能**：简化初创节点判断SQL语句
- **完善文档说明**：添加代谢引擎详细说明

### 未来计划
1. 支持更多数据库类型
2. 添加实时协作功能
3. 增强可视化效果
4. 支持导入/导出功能

## 技术支持
如有问题，请提交Issue到GitHub仓库或联系开发团队。
