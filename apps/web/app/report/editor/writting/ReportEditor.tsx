"use client";

import React from "react";
import "easymde/dist/easymde.min.css";
import dynamic from "next/dynamic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface Props {
  value: string;
}

const onChange = (value: string) => {
  console.log(value);
};

const MDEditor = dynamic(() => import("react-simplemde-editor"), {
  ssr: false,
});

const ReportEditor = ({ value }: Props) => {
  return (
    <Card className="h-[calc(100vh-7rem)] flex flex-col gap-2 overflow-y-auto">
      <CardHeader className="flex-shrink-0">
        <CardTitle>
          <div className="flex items-center justify-between">
            <p>Report Editor</p>
            <Button variant="outline">
              <Link href="/report/editor">Save</Link>
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 px-4 py-0 flex flex-col overflow-y-auto">
        <MDEditor
          value={value}
          onChange={onChange}
          options={{
            sideBySideFullscreen: false,
            previewClass: ["prose", "max-w-none", "editor-preview"],
            minHeight: undefined,
            maxHeight: "1000px",
            shortcuts: {
              toggleFullScreen: "",
            },
            hideIcons: ["fullscreen"],
          }}
        />
      </CardContent>
    </Card>
  );
};

export default ReportEditor;
