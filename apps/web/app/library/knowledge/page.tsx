"use client";

import React, { useState, useEffect, useMemo } from "react";
import { KnowledgeCard } from "@/components/business/KnowledgeCard";
import { Input } from "@/components/ui/input";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useKnowledge,
  useDeleteKnowledge,
  type KnowledgeItem,
} from "@/hooks/useKnowledge";
import { KnowledgeDialog } from "./components/KnowledgeDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const KnowledgePage = () => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKnowledge, setEditingKnowledge] =
    useState<KnowledgeItem | null>(null);
  const [deletingKnowledge, setDeletingKnowledge] =
    useState<KnowledgeItem | null>(null);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useKnowledge({
    search: debouncedSearch || undefined,
    limit: 50,
  });

  const deleteMutation = useDeleteKnowledge();

  const knowledgeList = useMemo(() => data?.items ?? [], [data?.items]);

  const handleCreate = () => {
    setEditingKnowledge(null);
    setDialogOpen(true);
  };

  const handleEdit = (knowledge: KnowledgeItem) => {
    setEditingKnowledge(knowledge);
    setDialogOpen(true);
  };

  const handleDelete = (knowledge: KnowledgeItem) => {
    setDeletingKnowledge(knowledge);
  };

  const confirmDelete = async () => {
    if (deletingKnowledge) {
      await deleteMutation.mutateAsync(deletingKnowledge.id);
      setDeletingKnowledge(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex gap-4">
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          创建知识库
        </Button>
        <Input
          placeholder="搜索知识库..."
          icon={<Search size={16} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx} className="rounded-2xl">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-3/4 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-5/6 mb-4" />
                <div className="flex gap-2 mt-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="text-center text-destructive py-8">
          加载失败，请稍后重试
        </div>
      ) : knowledgeList.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          {search ? "没有找到匹配的知识库" : "暂无知识库，点击上方按钮创建"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {knowledgeList.map((knowledge) => (
            <KnowledgeCard
              key={knowledge.id}
              knowledge={knowledge}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <KnowledgeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        knowledge={editingKnowledge}
      />

      <AlertDialog
        open={!!deletingKnowledge}
        onOpenChange={(open) => !open && setDeletingKnowledge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除知识库 &quot;{deletingKnowledge?.name}&quot;
              吗？此操作将删除所有关联的文件和切片，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-white"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default KnowledgePage;
