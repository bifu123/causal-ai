import openai
from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv()

# 初始化客户端
client = OpenAI(
    api_key=os.getenv("API_KEY"),
    base_url=os.getenv("BASE_URL")
)


def get_lite_tuple(char_length, source_content):
    prompt = f"""请将以下原始表达：

{source_content}

提炼为{char_length}字以内的内容。注意以下要点：
1. 只包含基本主谓二元组｀<谁><做了什么>`（在字数限制时最低考量）
2. 包含完整叙事六元组：时间、地点、人物、起因、冲突、结果（在字数允许时尽量考量）
3. 注意原始表达中隐含时间表达（非必须）
4. 输出为通顺自然的内容，不要有任何分析和对比
"""

    
    # 发起聊天请求
    response = client.chat.completions.create(
        model=os.getenv("MODEL"),
        messages=[
            {"role": "system", "content": "请根据用户要求对文字表达提炼总结。"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        stream=False  # 如果需要流式传输，改为 True 并遍历 response
    )

    # 打印输出
    return response.choices[0].message.content

if __name__ == "__main__":
    char_length = 50
    source_content = """### 周末去钓鱼

期待已久的周末终于到了，今天阳光明媚，微风习习，爸爸决定带我去郊外的河边钓鱼。

一到河边，两岸的垂柳随风摇曳，清澈的河面波光粼粼。爸爸熟练地组装好鱼竿，调好鱼饵，然后耐心地教我：“钓鱼得有耐心，浮漂一动，千万别急着拉。”我似懂非懂地点点头，学着爸爸的样子，用力将鱼钩甩进水里，便目不转睛地盯着浮漂。

时间一分一秒过去，火辣辣的太阳晒得我有些发慌，正当我坐立不安、想要放弃时，水面上的浮漂突然猛地沉了一下！“收线！”爸爸在一旁急促地喊道。我精神一振，使劲往上一提。哇，一条巴掌大的鲫鱼在空中扑腾，银色的鳞片在阳光下闪闪发光！

看着水桶里游得欢快的小鱼，我心里美滋滋的。这个周末，我不仅收获了美味的活鱼，更懂得了做任何事都要坚持不懈的道理。"""

    response = get_lite_tuple(char_length, source_content)
    print(response)