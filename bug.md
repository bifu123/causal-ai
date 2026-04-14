一、又贞和对贞操作没有把当前owner_id参数加入，导致写入数据库的owner_id都是default。
二、index.html 2d界面中的tooltip:
- 最大宽度（500px）
- 最大高度 (550px)
- 字符截取 (250字符)
- 显示内容：node_id、权重、内容摘要
- 样式：node_id、权重、内容摘要不同的样式
三、3d_main.html中编辑父ID处理有BUG，应该参照index.html方式处理：
1，点击父ID文本框即进入了父ID编辑模式 is_change=false,在此模式下，点击任何节点都不会将该节点信息字段读取到抽屉里
2, 点击父ID文体框清空原有值
3，点击其它节点，将其它节点的node_id填入父ID文本框，多个节点的node_id用 | 间隔
4，点编辑提交，节点信息更新到数据库，is_change=true
5，关闭抽屉
6，后端soketio发送数据前端重绘

四、判断事件是否重复写入，过滤条件应该是node_id和owner_id共同决定

请阅读bug.md，请逐条解决，用中文输出你的思考解决过程