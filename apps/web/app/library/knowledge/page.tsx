import React from "react";
import { NewsCard } from "@/components/business";
import type { NewsCardProps } from "@/components/business/NewsCard";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const knowledgeList: NewsCardProps[] = [
  {
    title: "Knowledge 1",
    summary: "Knowledge 1 summary Knowledge 1 summary Knowledge 1 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-01",
    mark: false,
  },
  {
    title: "Knowledge 2",
    summary: "Knowledge 2 summary",
    platform: "Twitter",
    time: "2025-01-02",
    mark: true,
  },
  {
    title: "Knowledge 3",
    summary: "Knowledge 3 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-03",
    mark: true,
  },
  {
    title: "Knowledge 4",
    summary: "Knowledge 4 summary",
    platform: "Twitter",
    time: "2025-01-04",
    mark: false,
  },
  {
    title: "Knowledge 5",
    summary: "Knowledge 5 summary",
    image: "https://placehold.co/150",
    platform: "Twitter",
    time: "2025-01-05",
    mark: true,
  },
];

const KnowledgePage = () => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <div className="flex gap-2">
          <Button>
            <Plus />
            Create Knowledge
          </Button>
        </div>
        <Input placeholder="Search" icon={<Search size={16} />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {knowledgeList.map((knowledge) => (
          <NewsCard key={knowledge.title} {...knowledge} />
        ))}
      </div>
    </div>
  );
};

export default KnowledgePage;
