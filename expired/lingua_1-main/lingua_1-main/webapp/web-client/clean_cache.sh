#!/bin/bash
# Web客户端缓存清理脚本
# 用于清理构建缓存、node_modules和旧代码

echo "🧹 开始清理Web端缓存..."

# 1. 删除构建输出目录
if [ -d "dist" ]; then
    echo "  删除 dist 目录..."
    rm -rf dist
    echo "  ✅ dist 目录已删除"
else
    echo "  ℹ️  dist 目录不存在，跳过"
fi

# 2. 删除node_modules
if [ -d "node_modules" ]; then
    echo "  删除 node_modules 目录..."
    rm -rf node_modules
    echo "  ✅ node_modules 目录已删除"
else
    echo "  ℹ️  node_modules 目录不存在，跳过"
fi

# 3. 清理Vite缓存
VITE_CACHE_PATHS=(
    "node_modules/.vite"
    ".vite"
    "$HOME/.vite"
)

for path in "${VITE_CACHE_PATHS[@]}"; do
    if [ -d "$path" ]; then
        echo "  删除 Vite 缓存: $path..."
        rm -rf "$path"
        echo "  ✅ Vite 缓存已删除: $path"
    fi
done

# 4. 清理npm缓存（可选）
read -p "  是否清理npm全局缓存? (y/N): " clean_npm_cache
if [ "$clean_npm_cache" = "y" ] || [ "$clean_npm_cache" = "Y" ]; then
    echo "  清理npm缓存..."
    npm cache clean --force
    echo "  ✅ npm缓存已清理"
fi

# 5. 清理TypeScript编译缓存
if [ -f ".tsbuildinfo" ]; then
    echo "  删除 TypeScript 编译缓存..."
    rm -f .tsbuildinfo
    echo "  ✅ TypeScript 编译缓存已删除"
fi

# 6. 清理日志文件（可选）
read -p "  是否清理日志文件? (y/N): " clean_logs
if [ "$clean_logs" = "y" ] || [ "$clean_logs" = "Y" ]; then
    if [ -d "logs" ]; then
        echo "  删除 logs 目录..."
        rm -rf logs
        echo "  ✅ logs 目录已删除"
    fi
fi

echo ""
echo "✨ 清理完成！"
echo ""
echo "下一步操作："
echo "  1. 重新安装依赖: npm install"
echo "  2. 重新构建: npm run build"
echo "  3. 在浏览器中硬刷新 (Ctrl+Shift+R 或 Ctrl+F5)"

