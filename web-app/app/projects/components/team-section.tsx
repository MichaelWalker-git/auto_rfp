import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  UserPlus,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function TeamSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Team</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search team members..." className="w-[250px] pl-8" />
          </div>
          <Button variant="outline" size="sm" className="gap-1">
            <Filter className="h-4 w-4" />
            Filter
          </Button>
          <Button size="sm" className="gap-1">
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        </div>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Team Members (5)</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Project Team</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    name: "John Doe",
                    role: "Project Owner",
                    email: "john.doe@example.com",
                    status: "Online",
                    avatar: "JD",
                    sections: ["Technical Approach", "Implementation Plan"],
                    questions: 15,
                  },
                  {
                    name: "Sarah Kim",
                    role: "Technical Lead",
                    email: "sarah.kim@example.com",
                    status: "Online",
                    avatar: "SK",
                    sections: ["Technical Approach", "Security & Compliance"],
                    questions: 22,
                  },
                  {
                    name: "Mike Johnson",
                    role: "Solution Architect",
                    email: "mike.johnson@example.com",
                    status: "Offline",
                    avatar: "MJ",
                    sections: ["Technical Approach"],
                    questions: 8,
                  },
                  {
                    name: "Lisa Chen",
                    role: "Project Manager",
                    email: "lisa.chen@example.com",
                    status: "Offline",
                    avatar: "LC",
                    sections: ["Implementation Plan", "Company Information"],
                    questions: 12,
                  },
                  {
                    name: "David Wilson",
                    role: "Financial Analyst",
                    email: "david.wilson@example.com",
                    status: "Offline",
                    avatar: "DW",
                    sections: ["Pricing & Terms"],
                    questions: 6,
                  },
                ].map((member, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage
                          src={`/abstract-geometric-shapes.png?height=40&width=40&query=${member.avatar}`}
                          alt={member.name}
                        />
                        <AvatarFallback>{member.avatar}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{member.name}</h3>
                          {member.status === "Online" ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700">
                              Online
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-100 text-gray-500">
                              Offline
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{member.role}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1">
                        {member.sections.map((section, idx) => (
                          <Badge key={idx} variant="outline" className="bg-blue-50 text-blue-700">
                            {section}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span>{member.questions} questions assigned</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="gap-1">
                        <MessageSquare className="h-3.5 w-3.5" />
                        Message
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Profile</DropdownMenuItem>
                          <DropdownMenuItem>Assign Questions</DropdownMenuItem>
                          <DropdownMenuItem>Remove from Project</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Team Workload</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { name: "John Doe", assigned: 15, completed: 8, avatar: "JD" },
                    { name: "Sarah Kim", assigned: 22, completed: 15, avatar: "SK" },
                    { name: "Mike Johnson", assigned: 8, completed: 3, avatar: "MJ" },
                    { name: "Lisa Chen", assigned: 12, completed: 9, avatar: "LC" },
                    { name: "David Wilson", assigned: 6, completed: 2, avatar: "DW" },
                  ].map((member, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage
                              src={`/abstract-geometric-shapes.png?height=24&width=24&query=${member.avatar}`}
                              alt={member.name}
                            />
                            <AvatarFallback className="text-xs">{member.avatar}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{member.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {member.completed}/{member.assigned} completed
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{
                            width: `${(member.completed / member.assigned) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Team Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="rounded-lg border p-3">
                    <h3 className="text-sm font-medium">Upcoming Meetings</h3>
                    <div className="mt-2 space-y-2">
                      {[
                        {
                          title: "RFP Review Session",
                          date: "May 10, 2025",
                          time: "10:00 AM - 11:30 AM",
                          attendees: 5,
                        },
                        {
                          title: "Technical Deep Dive",
                          date: "May 12, 2025",
                          time: "2:00 PM - 3:30 PM",
                          attendees: 3,
                        },
                        {
                          title: "Final Review",
                          date: "May 14, 2025",
                          time: "9:00 AM - 11:00 AM",
                          attendees: 5,
                        },
                      ].map((meeting, index) => (
                        <div key={index} className="flex items-center justify-between rounded-md border p-2 text-sm">
                          <div>
                            <div className="font-medium">{meeting.title}</div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {meeting.date}, {meeting.time}
                              </span>
                            </div>
                          </div>
                          <Badge variant="outline">{meeting.attendees} attendees</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="w-full gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Schedule Meeting
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Team Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    user: "John Doe",
                    action: "answered question",
                    item: "Technical Architecture Overview",
                    time: "2 hours ago",
                    icon: CheckCircle2,
                    avatar: "JD",
                  },
                  {
                    user: "Sarah Kim",
                    action: "uploaded document",
                    item: "Security Compliance Framework.pdf",
                    time: "5 hours ago",
                    icon: Calendar,
                    avatar: "SK",
                  },
                  {
                    user: "Mike Johnson",
                    action: "commented on",
                    item: "Pricing Structure",
                    time: "Yesterday",
                    icon: MessageSquare,
                    avatar: "MJ",
                  },
                  {
                    user: "Lisa Chen",
                    action: "scheduled meeting",
                    item: "RFP Review Session",
                    time: "Yesterday",
                    icon: Calendar,
                    avatar: "LC",
                  },
                  {
                    user: "David Wilson",
                    action: "updated answer for",
                    item: "Cost Breakdown",
                    time: "2 days ago",
                    icon: CheckCircle2,
                    avatar: "DW",
                  },
                  {
                    user: "John Doe",
                    action: "assigned question to",
                    item: "Sarah Kim",
                    time: "2 days ago",
                    icon: UserPlus,
                    avatar: "JD",
                  },
                  {
                    user: "Sarah Kim",
                    action: "completed review of",
                    item: "Security Questions",
                    time: "3 days ago",
                    icon: CheckCircle2,
                    avatar: "SK",
                  },
                  {
                    user: "Mike Johnson",
                    action: "added comment on",
                    item: "Technical Architecture",
                    time: "3 days ago",
                    icon: MessageSquare,
                    avatar: "MJ",
                  },
                  {
                    user: "Lisa Chen",
                    action: "updated project timeline in",
                    item: "Implementation Plan",
                    time: "4 days ago",
                    icon: Clock,
                    avatar: "LC",
                  },
                  {
                    user: "David Wilson",
                    action: "finalized",
                    item: "Payment Terms",
                    time: "4 days ago",
                    icon: CheckCircle2,
                    avatar: "DW",
                  },
                ].map((activity, index) => (
                  <div key={index} className="flex items-start gap-3 rounded-md border p-3">
                    <Avatar className="mt-0.5 h-8 w-8">
                      <AvatarImage
                        src={`/abstract-geometric-shapes.png?height=32&width=32&query=${activity.avatar}`}
                        alt={activity.user}
                      />
                      <AvatarFallback>{activity.avatar}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-medium">{activity.user}</span>
                        <span>{activity.action}</span>
                        <span className="font-medium">{activity.item}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <activity.icon className="h-3 w-3" />
                        <span>{activity.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
