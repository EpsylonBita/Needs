"use client";

import { useEffect, useState, useCallback } from 'react'

import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'

import { listListingImages, setMainListingImage, deleteListingImage, uploadListingImages } from '@/lib/services/storage-service'

type Img = { id: string; url: string; storage_path?: string; main: boolean }

export default function ListingImagesPage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? (params?.id[0] as string) : ((params?.id as string) || '')
  const router = useRouter()
  const [images, setImages] = useState<Img[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await listListingImages(id)
    setImages((data || []) as Img[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const onUpload = async () => {
    if (files.length === 0) return
    setLoading(true)
    await uploadListingImages(id, files)
    setFiles([])
    await load()
  }

  const setMain = async (imgId: string) => {
    setLoading(true)
    await setMainListingImage(id, imgId)
    await load()
  }

  const remove = async (imgId: string, path?: string) => {
    setLoading(true)
    await deleteListingImage(id, imgId, path)
    await load()
  }

  return (
    <div className="container mx-auto p-4 pt-[72px]">
      <h1 className="text-2xl font-bold">Listing Images</h1>
      <div className="mt-4 flex items-center gap-2">
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button disabled={loading} onClick={onUpload} className="px-3 py-1 rounded-md bg-blue-600 text-white">Upload</button>
        <button disabled={loading} onClick={() => router.back()} className="px-3 py-1 rounded-md bg-gray-600 text-white">Back</button>
      </div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        {images.map((img) => (
          <div key={img.id} className={`border rounded-md p-2 ${img.main ? 'ring-2 ring-blue-600' : ''}`}>
            <div className="relative w-full h-40">
              <Image
                src={img.url}
                alt="Listing image"
                fill
                sizes="(max-width: 768px) 50vw, 33vw"
                className="object-cover rounded"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button disabled={loading} onClick={() => setMain(img.id)} className="px-3 py-1 rounded-md bg-green-600 text-white">Set Main</button>
              <button disabled={loading} onClick={() => remove(img.id, img.storage_path)} className="px-3 py-1 rounded-md bg-red-600 text-white">Delete</button>
            </div>
          </div>
        ))}
        {images.length === 0 && (
          <div className="text-sm text-muted-foreground">No images</div>
        )}
      </div>
    </div>
  )
}
