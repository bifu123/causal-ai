#!/bin/bash
set -euo pipefail

# 配置
MASTER_HOST="192.168.66.39"
SLAVE_HOST="192.168.66.40"
DB_NAME="causal_ai_db"
DB_USER="postgres"
DB_PASS="Shift962512"
DB_PORT="5432"
BACKUP_DIR="/home/test/causal_ai/backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="${BACKUP_DIR}/causal_ai_db_${TIMESTAMP}.sql"

export PGPASSWORD="${DB_PASS}"

echo "========================================"
echo "  PostgreSQL 数据库复制脚本"
echo "========================================"
echo "主库: ${MASTER_HOST}:${DB_PORT}/${DB_NAME}"
echo "从库: ${SLAVE_HOST}:${DB_PORT}/${DB_NAME}"
echo "时间戳: ${TIMESTAMP}"
echo ""

# 1. 检查主库连接和数据库存在
echo "[1/8] 检查主库连接..."
psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -c "SELECT 1;" > /dev/null 2>&1 || {
    echo "[ERR] 无法连接主库 ${MASTER_HOST}"
    exit 1
}

psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}';" | grep -q 1 || {
    echo "[ERR] 主库上不存在数据库 ${DB_NAME}"
    exit 1
}
echo "[OK] 主库连接正常，数据库存在"

# 2. 检查从库连接
echo "[2/8] 检查从库连接..."
psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -c "SELECT 1;" > /dev/null 2>&1 || {
    echo "[ERR] 无法连接从库 ${SLAVE_HOST}"
    exit 1
}
echo "[OK] 从库连接正常"

# 3. 备份从库（如果存在）
echo "[3/8] 备份从库现有数据（如果存在）..."
mkdir -p "${BACKUP_DIR}"
if psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}';" | grep -q 1; then
    echo "      从库存在 ${DB_NAME}，正在导出备份..."
    pg_dump -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -F c -f "${BACKUP_DIR}/slave_${DB_NAME}_backup_${TIMESTAMP}.dump" 2>/dev/null || {
        echo "[WAN] 从库备份失败（可能无数据或权限问题），继续执行..."
    }
    if [ -f "${BACKUP_DIR}/slave_${DB_NAME}_backup_${TIMESTAMP}.dump" ]; then
        echo "[OK] 从库备份完成: ${BACKUP_DIR}/slave_${DB_NAME}_backup_${TIMESTAMP}.dump"
        echo "      备份大小: $(du -h ${BACKUP_DIR}/slave_${DB_NAME}_backup_${TIMESTAMP}.dump | cut -f1)"
    fi
else
    echo "      从库不存在 ${DB_NAME}，跳过备份"
fi

# 4. 获取复制前统计信息
echo "[4/8] 获取主库统计信息..."
MASTER_TABLES=$(psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")
MASTER_INDEXES=$(psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema');")
echo "      主库表数量: ${MASTER_TABLES}"
echo "      主库索引数量: ${MASTER_INDEXES}"

# 5. 从主库导出数据（只读操作）
echo "[5/8] 从主库导出 ${DB_NAME}..."
pg_dump -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}"     --verbose     --no-owner     --no-privileges     --clean     --if-exists     > "${DUMP_FILE}" 2>"${DUMP_FILE}.log" || {
    echo "[ERR] 主库导出失败"
    echo "日志: ${DUMP_FILE}.log"
    cat "${DUMP_FILE}.log"
    exit 1
}
echo "[OK] 主库导出完成"
echo "      SQL文件: ${DUMP_FILE}"
echo "      文件大小: $(du -h ${DUMP_FILE} | cut -f1)"

# 6. 断开从库所有连接到 causal_ai_db 的会话
echo "[6/8] 断开从库上 ${DB_NAME} 的所有连接..."
psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = '${DB_NAME}' 
AND pid <> pg_backend_pid();
" > /dev/null 2>&1
echo "[OK] 已断开连接"

# 7. 在从库上删除并重建数据库，然后导入
echo "[7/8] 在从库上重建 ${DB_NAME} 并导入数据..."
psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" > /dev/null 2>&1
psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d postgres -c "CREATE DATABASE \"${DB_NAME}\";" > /dev/null 2>&1

psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" < "${DUMP_FILE}" > "${DUMP_FILE}.import.log" 2>&1 || {
    echo "[ERR] 导入从库失败"
    echo "导入日志: ${DUMP_FILE}.import.log"
    cat "${DUMP_FILE}.import.log"
    exit 1
}
echo "[OK] 从库导入完成"

# 8. 验证
echo "[8/8] 验证主从数据一致性..."
SLAVE_TABLES=$(psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');")
SLAVE_INDEXES=$(psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema');")

echo ""
echo "验证结果:"
echo "  主库表数量:   ${MASTER_TABLES}  |  从库表数量:   ${SLAVE_TABLES}"
echo "  主库索引数量: ${MASTER_INDEXES}  |  从库索引数量: ${SLAVE_INDEXES}"

if [ "${MASTER_TABLES}" = "${SLAVE_TABLES}" ]; then
    echo "  [OK] 表数量一致"
else
    echo "  [ERR] 表数量不一致！"
    exit 1
fi

if [ "${MASTER_INDEXES}" = "${SLAVE_INDEXES}" ]; then
    echo "  [OK] 索引数量一致"
else
    echo "  [WAN] 索引数量不一致"
fi

# 详细对比每张表的记录数
echo ""
echo "详细表记录数对比:"
printf "%-30s %10s %10s\n" "表名" "主库" "从库"
printf "%-30s %10s %10s\n" "------------------------------" "----------" "----------"

# 获取表列表
TABLES=$(psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name;")

for tbl in ${TABLES}; do
    schema=$(echo "${tbl}" | cut -d'.' -f1)
    table=$(echo "${tbl}" | cut -d'.' -f2)

    master_count=$(psql -h "${MASTER_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM \"${schema}\".\"${table}\";" 2>/dev/null || echo "ERR")
    slave_count=$(psql -h "${SLAVE_HOST}" -U "${DB_USER}" -p "${DB_PORT}" -d "${DB_NAME}" -Atc "SELECT COUNT(*) FROM \"${schema}\".\"${table}\";" 2>/dev/null || echo "ERR")

    if [ "${master_count}" = "${slave_count}" ]; then
        status="✓"
    else
        status="✗"
    fi
    printf "%-30s %10s %10s %s\n" "${tbl}" "${master_count}" "${slave_count}" "${status}"
done

echo ""
echo "========================================"
echo "  复制完成"
echo "========================================"
echo "主库: ${MASTER_HOST}:${DB_PORT}/${DB_NAME}"
echo "从库: ${SLAVE_HOST}:${DB_PORT}/${DB_NAME}"
echo "导出文件: ${DUMP_FILE}"
echo "备份目录: ${BACKUP_DIR}"

