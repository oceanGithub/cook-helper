# -*- coding: utf-8 -*-
import os
base = r'C:\Users\Administrator\Desktop\奇思妙想\小嘟干饭'
path = os.path.join(base, r'miniprogram\pages\calendar\calendar.ts')
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Check brace balance
content = ''.join(lines)
opens = content.count('{')
closes = content.count('}')
print(f'Total lines: {len(lines)}')
print(f'Braces: {{ = {opens}, }} = {closes}, diff = {opens - closes}')

# Check around the getImageUrls area (where I made changes)
for i, line in enumerate(lines, 1):
    if 'getImageUrls' in line:
        start = max(0, i - 3)
        end = min(len(lines), i + 20)
        print(f'\n=== Around L{i} ===')
        for j in range(start, end):
            print(f'{j+1}: {lines[j]}', end='')
        break