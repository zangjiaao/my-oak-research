spec: task
name: "TEAMPLATE"
inherits: project
tags: []
---

## 意图

在此描述任务目标和背景。

## 已定决策

- 在此写明已经确定的技术选择

## 边界

### 允许修改
- 在此列出允许修改的文件或模块

### 禁止做
- 在此列出禁止做的事情

## 完成条件

场景: 正常路径
  测试:
    包: your-package
    过滤: test_happy_path
  假设 前置条件
  当 用户执行操作
  那么 期望结果

场景: 异常路径
  测试:
    包: your-package
    过滤: test_error_path
  假设 前置条件
  当 用户执行异常操作
  那么 系统返回错误

## 排除范围

- 不在本任务范围内的功能
