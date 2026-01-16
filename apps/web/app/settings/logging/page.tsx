import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Search } from "lucide-react";

const Log = () => {
  return (
    <div>
      <Tabs defaultValue="system" className="space-y-2">
        <TabsList>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="action">Action</TabsTrigger>
          <TabsTrigger value="push">Push</TabsTrigger>
        </TabsList>

        <TabsContent value="system">
          <Card>
            <CardContent>
              <div className="flex-1">
                <Input
                  placeholder="Search system logs..."
                  icon={<Search size={16} />}
                  className="pl-9 bg-muted border-none"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Content</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>1</TableCell>
                    <TableCell>2025-09-18</TableCell>
                    <TableCell>System</TableCell>
                    <TableCell>Content</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="action">
          <Card>
            <CardContent>
              <div className="flex-1">
                <Input
                  placeholder="Search action logs..."
                  icon={<Search size={16} />}
                  className="pl-9 bg-muted border-none"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Content</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>1</TableCell>
                    <TableCell>2025-09-18</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Content</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="push">
          <Card>
            <CardContent>
              <div className="flex-1">
                <Input
                  placeholder="Search push logs..."
                  icon={<Search size={16} />}
                  className="pl-9 bg-muted border-none"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Content</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>1</TableCell>
                    <TableCell>2025-09-18</TableCell>
                    <TableCell>Push</TableCell>
                    <TableCell>Content</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Log;
