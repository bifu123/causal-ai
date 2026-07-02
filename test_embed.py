from tools import search_causal_by_embed, search_causal_by_keyword
import json

qrery = "因果星空（四）：因果链操作系统"

print("Testing search_causal_by_embed...")
result = search_causal_by_embed(qrery, limit=5)
print(json.dumps(result, ensure_ascii=False, indent=2))
print("*" * 60)
result = search_causal_by_keyword(qrery, limit=5)
print(json.dumps(result, ensure_ascii=False, indent=2))

