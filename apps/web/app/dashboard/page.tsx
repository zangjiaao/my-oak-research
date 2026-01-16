import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Newspaper,
  Users,
  Building,
  Bed,
  UtensilsCrossed,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const Dashboard = () => {
  const stats = [
    {
      title: "Total Keywords",
      value: 100,
      change: 10,
      icon: BarChart,
      color: "text-blue-500",
    },
    {
      title: "Total News",
      value: 100,
      change: 10,
      icon: Newspaper,
      color: "text-green-500",
    },
    {
      title: "Total Users",
      value: 100,
      change: 10,
      icon: Users,
      color: "text-purple-500",
    },
    {
      title: "Total Organizations",
      value: 100,
      change: 10,
      icon: Building,
      color: "text-orange-500",
    },
  ];
  const recentBookings = [
    {
      id: 1,
      guest: "John Doe",
      room: "Room 101",
      checkIn: "2025-01-01",
      status: "confirmed",
    },
    {
      id: 2,
      guest: "Jane Smith",
      room: "Room 102",
      checkIn: "2025-01-02",
      status: "pending",
    },
    {
      id: 3,
      guest: "Alice Johnson",
      room: "Room 103",
      checkIn: "2025-01-03",
      status: "cancelled",
    },
  ];
  return (
    <div className="space-y-4">
      {/* Top 5 Keywords */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-600">{stat.change}</span> from last
                month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent Bookings</CardTitle>
            <CardDescription>Latest hotel reservations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{booking.guest}</p>
                    <p className="text-sm text-muted-foreground">
                      {booking.room}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Check-in: {booking.checkIn}
                    </p>
                  </div>
                  <Badge
                    variant={
                      booking.status === "confirmed"
                        ? "default"
                        : booking.status === "pending"
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {booking.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Bookings</CardTitle>
            <CardDescription>Latest hotel reservations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{booking.guest}</p>
                    <p className="text-sm text-muted-foreground">
                      {booking.room}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Check-in: {booking.checkIn}
                    </p>
                  </div>
                  <Badge
                    variant={
                      booking.status === "confirmed"
                        ? "default"
                        : booking.status === "pending"
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {booking.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Frequently used actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button variant="outline" className="h-16 flex-col">
              <Bed className="w-5 h-5 mb-1" />
              New Booking
            </Button>
            <Button variant="outline" className="h-16 flex-col">
              <UtensilsCrossed className="w-5 h-5 mb-1" />
              Add Order
            </Button>
            <Button variant="outline" className="h-16 flex-col">
              <Users className="w-5 h-5 mb-1" />
              Check-in Guest
            </Button>
            <Button variant="outline" className="h-16 flex-col">
              <Calendar className="w-5 h-5 mb-1" />
              View Schedule
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
