'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Loader2, 
  Briefcase,
  ChevronRight,
  ChevronLeft,
  Save
} from 'lucide-react';
import { useUpdatePastProject } from '@/lib/hooks/use-past-performance';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { PastProject } from '@auto-rfp/shared';

const EditPastProjectFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  client: z.string().min(1, 'Client name is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  contractNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  value: z.coerce.number().optional(),
  technicalApproach: z.string().optional(),
  achievements: z.string().optional(),
  performanceRating: z.coerce.number().min(1).max(5).optional(),
  domain: z.string().optional(),
  technologies: z.string().optional(),
  naicsCodes: z.string().optional(),
  contractType: z.string().optional(),
  setAside: z.string().optional(),
  teamSize: z.coerce.number().optional(),
  durationMonths: z.coerce.number().optional(),
  clientPOCName: z.string().optional(),
  clientPOCEmail: z.string().email().optional().or(z.literal('')),
  clientPOCPhone: z.string().optional(),
});

type EditPastProjectFormData = z.infer<typeof EditPastProjectFormSchema>;

interface EditPastProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: PastProject;
  orgId: string;
  onSuccess?: () => void;
}

const steps = [
  { id: 'basic', title: 'Basic Info', description: 'Project details' },
  { id: 'contract', title: 'Contract', description: 'Timeline & value' },
  { id: 'technical', title: 'Technical', description: 'Approach & tech' },
  { id: 'contact', title: 'Contact', description: 'Client POC' },
];

export function EditPastProjectDialog({ 
  open, 
  onOpenChange, 
  project, 
  orgId,
  onSuccess 
}: EditPastProjectDialogProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const updateProject = useUpdatePastProject();
  const { toast } = useToast();

  const form = useForm<EditPastProjectFormData>({
    resolver: zodResolver(EditPastProjectFormSchema),
    defaultValues: {
      title: '',
      client: '',
      description: '',
      contractNumber: '',
      startDate: '',
      endDate: '',
      value: undefined,
      technicalApproach: '',
      achievements: '',
      performanceRating: undefined,
      domain: '',
      technologies: '',
      naicsCodes: '',
      contractType: '',
      setAside: '',
      teamSize: undefined,
      durationMonths: undefined,
      clientPOCName: '',
      clientPOCEmail: '',
      clientPOCPhone: '',
    },
  });

  const { watch, formState: { isSubmitting, isDirty } } = form;

  // Populate form when project changes
  useEffect(() => {
    if (project && open) {
      form.reset({
        title: project.title || '',
        client: project.client || '',
        description: project.description || '',
        contractNumber: project.contractNumber || '',
        startDate: project.startDate ? project.startDate.split('T')[0] : '',
        endDate: project.endDate ? project.endDate.split('T')[0] : '',
        value: project.value || undefined,
        technicalApproach: project.technicalApproach || '',
        achievements: project.achievements?.join('\n') || '',
        performanceRating: project.performanceRating || undefined,
        domain: project.domain || '',
        technologies: project.technologies?.join(', ') || '',
        naicsCodes: project.naicsCodes?.join(', ') || '',
        contractType: project.contractType || '',
        setAside: project.setAside || '',
        teamSize: project.teamSize || undefined,
        durationMonths: project.durationMonths || undefined,
        clientPOCName: project.clientPOC?.name || '',
        clientPOCEmail: project.clientPOC?.email || '',
        clientPOCPhone: project.clientPOC?.phone || '',
      });
    }
  }, [project, open, form]);

  const watchedTitle = watch('title');
  const watchedClient = watch('client');
  const watchedDescription = watch('description');

  const isBasicComplete = watchedTitle && watchedClient && watchedDescription?.length >= 10;

  const onSubmit = async (data: EditPastProjectFormData) => {
    try {
      const updates = {
        title: data.title,
        client: data.client,
        description: data.description,
        contractNumber: data.contractNumber || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        value: data.value || undefined,
        technicalApproach: data.technicalApproach || undefined,
        achievements: data.achievements ? data.achievements.split('\n').filter(Boolean) : [],
        performanceRating: data.performanceRating || undefined,
        domain: data.domain || undefined,
        technologies: data.technologies ? data.technologies.split(',').map(t => t.trim()).filter(Boolean) : [],
        naicsCodes: data.naicsCodes ? data.naicsCodes.split(',').map(n => n.trim()).filter(Boolean) : [],
        contractType: data.contractType || undefined,
        setAside: data.setAside || undefined,
        teamSize: data.teamSize || undefined,
        durationMonths: data.durationMonths || undefined,
        clientPOC: data.clientPOCName ? {
          name: data.clientPOCName,
          email: data.clientPOCEmail || undefined,
          phone: data.clientPOCPhone || undefined,
        } : undefined,
      };

      await updateProject.trigger({ 
        orgId, 
        projectId: project.projectId, 
        updates 
      });
      
      toast({
        title: 'Project Updated',
        description: `"${data.title}" has been updated successfully.`,
      });
      
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to update past project:', error);
      toast({
        title: 'Error',
        description: 'Failed to update project. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setCurrentStep(0);
    }
    onOpenChange(newOpen);
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Briefcase className="h-5 w-5" />
            Edit Past Performance Project
          </DialogTitle>
          <DialogDescription>
            Update project details. Changes will be saved when you click Save.
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <React.Fragment key={step.id}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(index)}
                  className="flex flex-col items-center gap-1 cursor-pointer transition-colors"
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                      index === currentStep
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {index + 1}
                  </div>
                  <span className={cn(
                    "text-xs font-medium hidden sm:block",
                    index === currentStep ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.title}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <div className="flex-1 h-0.5 mx-2 bg-muted" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <Separator />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-[450px]">
              <div className="px-6 py-4">
                {/* Step 1: Basic Info */}
                {currentStep === 0 && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Title *</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Cloud Migration for DoD" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="client"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Department of Defense" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Description *</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe the project scope, objectives, and outcomes..."
                              rows={4}
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>
                            Be specific about deliverables and outcomes (min. 10 characters)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="contractNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contract Number</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., FA8750-21-C-0001" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="domain"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Domain/Industry</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., Defense, Healthcare" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Step 2: Contract Details */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="value"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contract Value ($)</FormLabel>
                            <FormControl>
                              <Input type="number" placeholder="e.g., 5000000" {...field} />
                            </FormControl>
                            <FormDescription>Total contract value in dollars</FormDescription>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="teamSize"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Team Size</FormLabel>
                            <FormControl>
                              <Input type="number" placeholder="e.g., 25" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="contractType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contract Type</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="FFP">FFP</SelectItem>
                                <SelectItem value="T&M">T&M</SelectItem>
                                <SelectItem value="CPFF">CPFF</SelectItem>
                                <SelectItem value="CPAF">CPAF</SelectItem>
                                <SelectItem value="IDIQ">IDIQ</SelectItem>
                                <SelectItem value="BPA">BPA</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="setAside"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Set-Aside</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="NONE">Full & Open</SelectItem>
                                <SelectItem value="SB">Small Business</SelectItem>
                                <SelectItem value="8A">8(a)</SelectItem>
                                <SelectItem value="SDVOSB">SDVOSB</SelectItem>
                                <SelectItem value="WOSB">WOSB</SelectItem>
                                <SelectItem value="HUBZone">HUBZone</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="performanceRating"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rating</FormLabel>
                            <Select 
                              onValueChange={(v) => field.onChange(parseInt(v))} 
                              value={field.value?.toString() || ''}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="5">5 - Exceptional</SelectItem>
                                <SelectItem value="4">4 - Very Good</SelectItem>
                                <SelectItem value="3">3 - Satisfactory</SelectItem>
                                <SelectItem value="2">2 - Marginal</SelectItem>
                                <SelectItem value="1">1 - Unsatisfactory</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Step 3: Technical Details */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="technicalApproach"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Technical Approach</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe the technical approach, methodologies, and solutions used..."
                              rows={3}
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>
                            Include methodologies, frameworks, and key technical decisions
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="achievements"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Key Achievements</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Reduced costs by 30%&#10;Improved system uptime to 99.9%&#10;Migrated 500+ applications"
                              rows={3}
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>
                            One achievement per line. Quantify where possible.
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="technologies"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Technologies</FormLabel>
                          <FormControl>
                            <Input placeholder="AWS, Kubernetes, Python, React (comma-separated)" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="naicsCodes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>NAICS Codes</FormLabel>
                          <FormControl>
                            <Input placeholder="541512, 541519, 518210 (comma-separated)" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Step 4: Client Contact */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        Provide reference contact information for past performance verification.
                        This information may be used during proposal submissions.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="clientPOCName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., John Smith" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="clientPOCEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="john.smith@agency.gov" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="clientPOCPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="(555) 123-4567" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <Separator />

            <DialogFooter className="px-6 py-4">
              <div className="flex items-center justify-between w-full">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={prevStep}
                  disabled={currentStep === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>

                <div className="flex items-center gap-3">
                  {isDirty && (
                    <span className="text-xs text-amber-600">Unsaved changes</span>
                  )}
                  
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                      Cancel
                    </Button>
                    
                    {currentStep < steps.length - 1 ? (
                      <Button type="button" onClick={nextStep}>
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button type="submit" disabled={isSubmitting || !isBasicComplete}>
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save Changes
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default EditPastProjectDialog;