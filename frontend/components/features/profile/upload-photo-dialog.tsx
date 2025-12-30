"use client"

import { useState } from "react"

import Image from "next/image"
import { useRouter } from "next/navigation"

import { ImageIcon, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/contexts/auth-context"
import { profileService } from "@/lib/services/profile-service"
import { cn } from "@/lib/utils"

interface UploadPhotoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (url: string) => void
  type: "avatar" | "cover"
  currentImage?: string | null
}

export function UploadPhotoDialog({ open, onOpenChange, onUpload, type, currentImage }: UploadPhotoDialogProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const handleFile = (file: File) => {
    setError(null)
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result as string
      setPreview(result)
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleSave = async () => {
    if (!preview) return
    
    if (!user) {
      toast.error('Please log in to upload photos')
      router.push('/login')
      return
    }

    try {
      setIsUploading(true)
      // Convert base64 to File object
      const byteString = atob(preview.split(',')[1])
      const mime = preview.split(',')[0].split(':')[1].split(';')[0]
      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i)
      const blob = new Blob([ab], { type: mime })
      const file = new File([blob], `${type}-photo.${mime.split('/')[1]}`, { type: mime })

      // Upload the file
      const result = await profileService.uploadPhoto(file, type)
      
      // Update the UI with the new image URL
      onUpload(result.url)
      onOpenChange(false)
      toast.success(`${type === 'avatar' ? 'Profile photo' : 'Cover image'} updated successfully`)
    } catch (err: unknown) {
      console.error('Upload error:', err)
      const e = err as { message?: string; response?: { status?: number } } | Error
      if ((e as { response?: { status?: number } })?.response?.status === 401) {
        toast.error('Your session has expired. Please log in again')
        router.push('/login')
      } else {
        const errorMessage = (e as { message?: string })?.message || `Failed to upload ${type === 'avatar' ? 'profile photo' : 'cover image'}`
        toast.error(errorMessage)
        setError(errorMessage)
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Upload {type === "avatar" ? "Profile Photo" : "Cover Image"}</DialogTitle>
          <DialogDescription>
            Choose an image to upload. The image must be less than 5MB.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div
            className={cn(
              "group relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-6 transition-colors",
              isDragging ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-400",
              type === "avatar" && "aspect-square",
              type === "cover" && "aspect-[3/1]"
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="image/*"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={handleChange}
              aria-label={`Upload ${type === "avatar" ? "profile" : "cover"} photo`}
              title={`Choose ${type === "avatar" ? "profile" : "cover"} photo`}
            />
            
            {preview || currentImage ? (
              <div className="relative h-full w-full">
                <Image
                  src={preview || currentImage || ""}
                  alt="Preview"
                  fill
                  sizes="(max-width: 640px) 90vw, 425px"
                  className={cn(
                    "object-cover",
                    type === "avatar" && "rounded-full"
                  )}
                />
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute -right-2 -top-2 h-6 w-6 p-0"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setPreview(null)
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="rounded-full bg-blue-50 p-4">
                  <ImageIcon className="h-8 w-8 text-blue-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Drop your image here or click to browse</p>
                  <p className="text-xs text-gray-500">Supports JPG, PNG, GIF (Max 5MB)</p>
                </div>
              </>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!preview || isUploading}
          >
            {isUploading ? 'Uploading...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
