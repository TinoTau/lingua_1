# 音频能量切分：多段切分能力分析

## 问题

能量分析是只支持一分为二还是能分成多个短句的？

## 代码逻辑分析

### `splitAudioByEnergy` 的递归切分机制

查看 `audio-aggregator-utils.ts` 的 `splitAudioByEnergy` 方法：

```typescript
splitAudioByEnergy(
  audio: Buffer,
  maxSegmentDurationMs: number = 5000,
  minSegmentDurationMs: number = 2000,
  splitHangoverMs: number = 600,
  depth: number = 0
): Buffer[] {
  // 1. 检查递归深度（最大10层）
  if (depth >= MAX_DEPTH) {
    return [audio];
  }

  // 2. 如果音频足够短，直接返回
  if (totalDurationMs <= maxSegmentDurationMs) {
    return [audio];
  }

  // 3. 找到最长停顿并切分（一分为二）
  const splitResult = this.findLongestPauseAndSplit(audio);
  if (!splitResult) {
    return [audio];  // 找不到停顿，返回整段
  }

  // 4. 在最长停顿处切分
  const firstHalf = audio.slice(0, hangoverEnd);
  const secondHalf = audio.slice(hangoverEnd);

  // 5. 检查切分后的两段是否都足够短
  if (firstHalfDurationMs <= maxSegmentDurationMs && 
      secondHalfDurationMs <= maxSegmentDurationMs) {
    return [firstHalf, secondHalf];  // ✅ 两段都足够短，返回两段
  }

  // 6. 递归切分前后两段
  const firstSegments = this.splitAudioByEnergy(
    firstHalf, maxSegmentDurationMs, minSegmentDurationMs, splitHangoverMs, depth + 1
  );
  const secondSegments = this.splitAudioByEnergy(
    secondHalf, maxSegmentDurationMs, minSegmentDurationMs, splitHangoverMs, depth + 1
  );

  // 7. 合并所有结果
  return [...firstSegments, ...secondSegments];  // ✅ 合并多段结果
}
```

## 结论：支持多段切分

### 递归机制

1. **每次递归只切一次**：在**最长停顿**处一分为二
2. **递归切分**：如果切分后的段仍然 > `maxSegmentDurationMs`，继续递归切分
3. **合并结果**：最终返回所有切分段的数组

### 切分示例

假设有一段 **15秒** 的音频，包含多个停顿：

```
音频: [====停顿1====][====停顿2====][====停顿3====]
      5秒           5秒           5秒
```

**切分过程**：

1. **第1次递归（depth=0）**：
   - 找到最长停顿（假设是停顿2）
   - 切分：`[前10秒]` + `[后5秒]`
   - 前10秒 > 5秒，需要继续切分
   - 后5秒 <= 5秒，直接返回

2. **第2次递归（depth=1，前10秒）**：
   - 找到最长停顿（停顿1）
   - 切分：`[前5秒]` + `[后5秒]`
   - 两段都 <= 5秒，直接返回

3. **最终结果**：
   ```typescript
   [
     Buffer(前5秒),   // 第1段
     Buffer(中5秒),   // 第2段
     Buffer(后5秒)    // 第3段
   ]
   ```

### 限制条件

1. **最大递归深度**：10层（防止栈溢出）
   - 如果超过10层，直接返回整段

2. **最小段长度**：`minSegmentDurationMs`（默认2秒）
   - 如果音频 < 2秒，不会切分

3. **每次只找最长停顿**：
   - `findLongestPauseAndSplit` 只返回**最长**的停顿位置
   - 不会一次性找到所有停顿并切分

## 切分策略：贪心算法

### 当前策略：贪心（每次切最长停顿）

```
算法：贪心切分
1. 找到最长停顿
2. 在最长停顿处切分
3. 递归处理前后两段
```

**优点**：
- 简单高效
- 递归深度可控

**缺点**：
- 每次只切一次，可能不是最优切分
- 如果音频有多个相似长度的停顿，可能切分不均匀

### 可能的改进：一次性找到所有停顿

```typescript
// 伪代码：改进方案
splitAudioByEnergy(audio) {
  // 1. 找到所有停顿（不只是最长）
  const allPauses = findAllPauses(audio);
  
  // 2. 在多个停顿处切分
  const segments = splitAtMultiplePauses(audio, allPauses);
  
  // 3. 如果某段仍然太长，递归切分
  return segments.map(seg => 
    seg.length > maxSegmentDurationMs 
      ? splitAudioByEnergy(seg) 
      : [seg]
  ).flat();
}
```

## 实际切分能力

### 支持多段切分

✅ **支持**：可以切分成多个段（2段、3段、4段...）

### 切分段数上限

理论上限：
- **最大递归深度**：10层
- **每层最多切2段**：2^10 = 1024段（理论上限）

实际上限：
- 受 `minSegmentDurationMs`（2秒）限制
- 15秒音频最多切分：15 / 2 = 7段（实际）

### 切分质量

**当前策略**：
- ✅ 会在自然停顿处切分（如果找到）
- ⚠️ 每次只切最长停顿，可能不是最优
- ⚠️ 如果音频很长但没有明显停顿，可能切分不均匀

## 总结

### 回答用户问题

**Q: 能量分析是只支持一分为二还是能分成多个短句的？**

**A: 支持多段切分**，通过递归机制实现：

1. **每次递归**：在最长停顿处一分为二
2. **递归切分**：如果切分后的段仍然太长，继续递归
3. **最终结果**：返回多个音频段的数组

### 示例

- **9秒音频，有2个停顿** → 可能切分成 **2-3段**
- **15秒音频，有3个停顿** → 可能切分成 **3-4段**
- **20秒音频，有多个停顿** → 可能切分成 **多个段**

### 注意事项

1. **每次只找最长停顿**：不是一次性找到所有停顿
2. **递归深度限制**：最大10层
3. **最小段长度**：2秒（避免切得太碎）

---

**文档结束**
