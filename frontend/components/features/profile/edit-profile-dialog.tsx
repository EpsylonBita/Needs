"use client"

import React, { useState } from "react"

import Image from "next/image"
import { useRouter } from "next/navigation"

import { zodResolver } from "@hookform/resolvers/zod"
import { Camera, Upload } from "lucide-react"
import { useForm } from "react-hook-form"
import * as z from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { profileService, UpdateProfileData, type ProfileData } from "@/lib/services/profile-service"
import { cn } from "@/lib/utils"

const profileSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  title: z.string().min(2, "Title must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  location: z.string().min(2, "Location must be at least 2 characters"),
  bio: z.string().min(10, "Bio must be at least 10 characters"),
})

type ProfileFormData = z.infer<typeof profileSchema>

interface EditProfileDialogProps {
  defaultValues: Pick<ProfileData, 'fullName' | 'title' | 'email' | 'location' | 'bio' | 'avatar'>;
  onUpdate?: (data: ProfileData) => void;
  currentAvatar?: string;
}

export function EditProfileDialog({ defaultValues, onUpdate, currentAvatar }: EditProfileDialogProps) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(currentAvatar || null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: defaultValues.fullName || '',
      title: defaultValues.title || '',
      email: defaultValues.email || '',
      location: defaultValues.location || '',
      bio: defaultValues.bio || '',
    },
  })

  const handlePhotoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      handlePhotoFile(file)
    }
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handlePhotoFile(file)
    }
  }

  const handlePhotoFile = (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      })
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Image must be less than 5MB",
        variant: "destructive",
      })
      return
    }

    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setPhotoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setIsSubmitting(true)
      console.log('Form data submitted:', data)

      // Prepare update data with all fields
      const updateData: UpdateProfileData = {
        fullName: data.fullName?.trim(),
        title: data.title?.trim(),
        email: data.email?.trim(),
        location: data.location?.trim(),
        bio: data.bio?.trim(),
      }

      // Remove undefined values
      const cleanedData: UpdateProfileData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      ) as UpdateProfileData;

      // Add photo if changed
      if (photoFile) {
        cleanedData.avatar = photoFile;
      }

      console.log('Sending update request with data:', cleanedData);
      const updatedProfile = await profileService.updateProfile(cleanedData);
      console.log('Received updated profile:', updatedProfile);

      // Update parent component
      if (onUpdate) {
        onUpdate(updatedProfile)
      }

      // Show success message
      toast({
        title: "Success",
        description: "Profile updated successfully",
      })

      // Close dialog
      setIsOpen(false)
      
    } catch (error: unknown) {
      console.error('Profile update error:', error)
      
      const err = error as { message?: string; response?: { status?: number } } | Error
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        toast({
          title: "Session expired",
          description: "Please log in again",
          variant: "destructive",
        })
        router.push('/login')
      } else {
        toast({
          title: "Error",
          description: (err as { message?: string })?.message || "Failed to update profile",
          variant: "destructive",
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      // Reset form with current values
      form.reset({
        fullName: defaultValues.fullName || '',
        title: defaultValues.title || '',
        email: defaultValues.email || '',
        location: defaultValues.location || '',
        bio: defaultValues.bio || '',
      })
      // Reset photo state
      setPhotoPreview(currentAvatar || null)
      setPhotoFile(null)
    }
  }, [isOpen, defaultValues, currentAvatar, form])

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={(open) => {
        if (!isSubmitting) {
          setIsOpen(open)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit Profile</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Make changes to your profile information here.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Photo Upload Section */}
          <div className="space-y-2">
            <Label>Profile Photo</Label>
            <div
              className={cn(
                "relative group cursor-pointer rounded-xl border-2 border-dashed p-4 transition-all",
                isDragging ? "border-primary bg-primary/5" : "border-muted hover:border-primary",
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handlePhotoDrop}
            >
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handlePhotoChange}
                aria-label="Upload profile photo"
              />
              <div className="flex flex-col items-center gap-2 text-center">
                {photoPreview ? (
                  <div className="relative w-32 h-32">
                    <Image
                      src={photoPreview}
                      alt="Profile preview"
                      fill
                      sizes="128px"
                      className="object-cover rounded-full"
                    />
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="w-8 h-8 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-32 h-32 rounded-full bg-muted flex items-center justify-center">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Drop your image here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supports JPG, PNG, GIF (Max 5MB)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                {...form.register("fullName")}
              />
              {form.formState.errors.fullName && (
                <p className="text-sm text-destructive">{form.formState.errors.fullName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Professional Title</Label>
              <Input
                id="title"
                {...form.register("title")}
              />
              {form.formState.errors.title && (
                <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                {...form.register("location")}
              />
              {form.formState.errors.location && (
                <p className="text-sm text-destructive">{form.formState.errors.location.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                {...form.register("bio")}
                className="min-h-[100px] resize-none"
              />
              {form.formState.errors.bio && (
                <p className="text-sm text-destructive">{form.formState.errors.bio.message}</p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
} 
