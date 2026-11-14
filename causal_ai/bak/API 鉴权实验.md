# API 鉴权实验

## 实验一: 以错误的token写入有主场

curl -X POST http://192.168.68.25:8094/api/v1/causal/genesis \
     -H "Content-Type: application/json" \
     -d '{
       "node_id": "test",
       "block_tag": "因",
       "action_tag": "贞",
       "event_tuple": "那一天阴云密布，雷电时不时划过天际，祭坛上摆着砍下的人牲的肢体，巨大的鼎里正在炖着被辟为两半的牛，热汤正在沸腾，奴隶们不断的地被敲碎脑袋，惨叫声传出很远。\n\n贞人蓬头散发，走上台来作法，别着腰刀（明阳花山石画），女奴献酒，族人围火载舞，但是用于祭祀的羌人仍然不够，因为十二天后就是从先祖太甲到母戊的大型祭祀。需要人牲四百多人，目前的库存实在紧缺，商王紧皱眉头，决定以最诚的心去打动上天。于是他亲自问卜....\n\n卜文曰：\n贞：\"王占曰：吉，其来\"\n\n翻译：商王占卜结果很好（事件主体投入意志），方国会来（预判）。",
       "full_image_url": "",
       "owner_id": "915555037_3787687088",
       "is_share": false,
       "return_serial_id": true,
       "token": "123456"
     }'

{"status":"error","message":"仅场主或 admin 可以录入贞卜；观测者请先创建自己的场","data":{"role":"anonymous"}}


## 实验二: 以正确的token写入有主场

curl -X POST http://192.168.68.25:8094/api/v1/causal/genesis \
     -H "Content-Type: application/json" \
     -d '{
       "node_id": "test",
       "block_tag": "因",
       "action_tag": "贞",
       "event_tuple": "那一天阴云密布，雷电时不时划过天际，祭坛上摆着砍下的人牲的肢体，巨大的鼎里正在炖着被辟为两半的牛，热汤正在沸腾，奴隶们不断的地被敲碎脑袋，惨叫声传出很远。\n\n贞人蓬头散发，走上台来作法，别着腰刀（明阳花山石画），女奴献酒，族人围火载舞，但是用于祭祀的羌人仍然不够，因为十二天后就是从先祖太甲到母戊的大型祭祀。需要人牲四百多人，目前的库存实在紧缺，商王紧皱眉头，决定以最诚的心去打动上天。于是他亲自问卜....\n\n卜文曰：\n贞：\"王占曰：吉，其来\"\n\n翻译：商王占卜结果很好（事件主体投入意志），方国会来（预判）。",
       "full_image_url": "",
       "owner_id": "915555037_3787687088",
       "is_share": false,
       "return_serial_id": true,
       "token": "123456|4f3359bc9e9e0b66bd4f00a8b992491c"
     }'

{"status":"success","data":{"node_id":"test","serial_id":4712}}


## 实验二: 以正确的token写入无主场

curl -X POST http://192.168.68.25:8094/api/v1/causal/genesis \
     -H "Content-Type: application/json" \
     -d '{
       "node_id": "test",
       "block_tag": "因",
       "action_tag": "贞",
       "event_tuple": "那一天阴云密布，雷电时不时划过天际，祭坛上摆着砍下的人牲的肢体，巨大的鼎里正在炖着被辟为两半的牛，热汤正在沸腾，奴隶们不断的地被敲碎脑袋，惨叫声传出很远。\n\n贞人蓬头散发，走上台来作法，别着腰刀（明阳花山石画），女奴献酒，族人围火载舞，但是用于祭祀的羌人仍然不够，因为十二天后就是从先祖太甲到母戊的大型祭祀。需要人牲四百多人，目前的库存实在紧缺，商王紧皱眉头，决定以最诚的心去打动上天。于是他亲自问卜....\n\n卜文曰：\n贞：\"王占曰：吉，其来\"\n\n翻译：商王占卜结果很好（事件主体投入意志），方国会来（预判）。",
       "full_image_url": "",
       "owner_id": "test111",
       "is_share": false,
       "return_serial_id": true,
       "token": "123456|4f3359bc9e9e0b66bd4f00a8b992491c"
     }'
{"status":"error","message":"仅场主或 admin 可以录入贞卜；观测者请先创建自己的场","data":{"role":"observer"}}

---

结论：实验通过