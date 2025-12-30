"use client"

import { useState } from "react"

import Image from "next/image"
import { useRouter } from "next/navigation"

import { format } from "date-fns"
import { Calendar, ImageIcon, Loader2, Mail, MapPin, MoreVertical, Upload } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useProfile } from "@/contexts"

import { ProfileData } from "@/lib/services/profile-service"
import { EditProfileDialog } from "./edit-profile-dialog"
import { UploadPhotoDialog } from "./upload-photo-dialog"

export function ProfileHeader() {
  const { profile, isLoading, updateProfile, refreshProfile } = useProfile()
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false)
  const [isCoverDialogOpen, setIsCoverDialogOpen] = useState(false)
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    )
  }

  if (!profile) {
    return null
  }

  const handlePhotoUpdate = async (type: "avatar" | "cover", url: string) => {
    try {
      await updateProfile({
        [type === "avatar" ? "avatar" : "coverImage"]: url,
      })
    } catch (error) {
      console.error(`Failed to update ${type}:`, error)
    }
  }

  const handleProfileUpdate = async (data: ProfileData) => {
    try {
      await refreshProfile()
    } catch (error) {
      console.error('Error updating profile:', error)
    }
  }

  const joinedDate = profile.createdAt ? format(new Date(profile.createdAt), 'MMMM yyyy') : ''

  return (
    <div className="relative -m-6">
      <div className="relative bg-gradient-to-b from-blue-500 to-white rounded-t-xl">
        {/* Cover Image Background */}
        {profile.coverImage && (
          <div
            className="absolute inset-x-0 top-0 h-60 rounded-t-xl overflow-hidden cursor-pointer group transition-all duration-200 ease-in-out hover:scale-101"
            onClick={() => setIsCoverDialogOpen(true)}
          >
            <div className="absolute inset-0">
              <Image
                src={profile.coverImage}
                alt="Cover"
                fill
                sizes="(max-width: 768px) 100vw, 1200px"
                className="object-cover transition-transform duration-200 group-hover:scale-105"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/50 rounded-t-xl" />
          </div>
        )}

        {/* Background Change Button */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 bg-black/10 hover:bg-black/20 backdrop-blur-sm z-10 text-gray-500 hover:text-white transition-colors duration-200 rounded-full"
          onClick={() => setIsCoverDialogOpen(true)}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>

        <div className="relative px-4 py-12">
          <div className="flex flex-col items-center space-y-4 md:flex-row md:space-x-8 md:space-y-0">
            {/* Avatar with Upload */}
            <div
              className="relative group cursor-pointer transition-transform duration-200 hover:scale-105"
              onClick={(e) => {
                e.stopPropagation()
                setIsAvatarDialogOpen(true)
              }}
            >
              <Avatar className="h-32 w-32 border-4 border-white shadow-lg transition-all duration-200 group-hover:scale-105">
                {profile.avatar ? (
                  <AvatarImage
                    src={profile.avatar || undefined}
                    alt={profile.fullName || ''}
                    className="object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <AvatarFallback className="bg-blue-100 text-blue-900 text-xl font-semibold">
                    {(profile.fullName || '').split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-80">
                <Upload className="h-8 w-8 text-white" />
              </div>
            </div>

            {/* User Info */}
            <div className="flex flex-1 flex-col items-center space-y-4 text-center md:items-start md:text-left">
              <div className="space-y-1">
                <h1 className="text-2xl font-bold text-gray-900">{profile.fullName}</h1>
                <p className="text-gray-700">{profile.title}</p>
              </div>

              <p className="max-w-2xl text-gray-700">
                {profile.bio}
              </p>
            </div>

            {/* Actions */}
            <div className="absolute bottom-4 right-4 flex gap-2">
              <Button onClick={() => router.push('/profile?tab=dashboard')} className="bg-blue-600 hover:bg-blue-700 text-white">
                Dashboard
              </Button>
              <EditProfileDialog
                defaultValues={{
                  fullName: profile.fullName,
                  title: profile.title,
                  email: profile.email,
                  location: profile.location,
                  bio: profile.bio,
                  avatar: profile.avatar,
                }}
                currentAvatar={profile.avatar || undefined}
                onUpdate={handleProfileUpdate}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 text-gray-900 border-gray-200 shadow-md hover:shadow-lg transition-shadow duration-200">
                    <MoreVertical className="h-4 w-4 mr-2" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => router.push('/profile?tab=dashboard')}>Open Dashboard</DropdownMenuItem>
                  <DropdownMenuItem>Share Profile</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {/* Moved Badges to bottom-left */}
        <div className="absolute bottom-2 left-6 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1 text-blue-500 hover:text-white transition-colors duration-200">
            <MapPin className="h-4 w-4 text-white hover:text-blue-500" /> {profile.location}
          </div>
          <div  className="flex items-center gap-1 text-blue-500 hover:text-white transition-colors duration-200" >
            <Mail className="h-4 w-4 text-white hover:text-blue-500" /> {profile.email}
          </div >
          <div className="flex items-center gap-1 text-blue-500 hover:text-white transition-colors duration-200">
            <Calendar className="h-4 w-4 text-white hover:text-blue-500" /> Joined {joinedDate}
          </div >
        </div>
      </div>

      {/* Upload Dialogs */}
      <UploadPhotoDialog
        open={isAvatarDialogOpen}
        onOpenChange={setIsAvatarDialogOpen}
        onUpload={(url) => handlePhotoUpdate("avatar", url)}
        type="avatar"
        currentImage={profile.avatar}
      />
      <UploadPhotoDialog
        open={isCoverDialogOpen}
        onOpenChange={setIsCoverDialogOpen}
        onUpload={(url) => handlePhotoUpdate("cover", url)}
        type="cover"
        currentImage={profile.coverImage}
      />
    </div>
  )
}
