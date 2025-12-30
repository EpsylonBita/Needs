"use client"

import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { witService } from '@/lib/services/wit-service'
import { CATEGORY_STRUCTURE } from '@/lib/constants/categories'
import { supabase } from '@/lib/supabase/client'

const formSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  category: z.string().min(1, "Please select a category"),
  subcategory: z.string().min(1, "Please select a subcategory"),
  price: z.string().optional(),
  contactNumber: z.string().min(10, "Please enter a valid contact number"),
  location: z.string().min(3, "Please enter a valid location"),
  images: z.array(z.any()).optional(),
  tags: z.array(z.string()).optional(),
})

type FormValues = z.infer<typeof formSchema>

interface UseAdFormStateReturn {
  // Form state
  form: any
  register: any
  handleSubmit: any
  setValue: any
  watch: any
  errors: any
  getValues: any
  
  // UI state
  imageFiles: File[]
  imagePreviews: string[]
  isSubmitting: boolean
  showMap: boolean
  coordinates: [number, number] | null
  locationName: string
  isLocating: boolean
  selectedCategory: string
  selectedSubcategory: string
  selectedTags: string[]
  suggestedTags: string[]
  isLoadingTags: boolean
  openCategory: boolean
  openSubcategory: boolean
  nlpInput: string
  isAnalyzing: boolean
  analysis: { tags: string[], smartTags: string[] }
  analysisSuccess: boolean
  analysisError: string | null
  onboardRequired: boolean
  
  // Actions
  setImageFiles: (files: File[]) => void
  setImagePreviews: (previews: string[]) => void
  setIsSubmitting: (submitting: boolean) => void
  setShowMap: (show: boolean) => void
  setCoordinates: (coords: [number, number] | null) => void
  setLocationName: (name: string) => void
  setIsLocating: (locating: boolean) => void
  setSelectedCategory: (category: string) => void
  setSelectedSubcategory: (subcategory: string) => void
  setSelectedTags: (tags: string[]) => void
  setSuggestedTags: (tags: string[]) => void
  setIsLoadingTags: (loading: boolean) => void
  setOpenCategory: (open: boolean) => void
  setOpenSubcategory: (open: boolean) => void
  setNlpInput: (input: string) => void
  setIsAnalyzing: (analyzing: boolean) => void
  setAnalysis: (analysis: { tags: string[], smartTags: string[] }) => void
  setAnalysisSuccess: (success: boolean) => void
  setAnalysisError: (error: string | null) => void
  setOnboardRequired: (required: boolean) => void
  resetForm: () => void
  handleImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  removeImage: (index: number) => void
  handleCategorySelect: (category: string) => void
  handleSubcategorySelect: (subcategory: string) => void
  toggleTag: (tag: string) => void
  fetchAISuggestions: () => Promise<void>
  checkOnboarding: () => Promise<void>
}

/**
 * Custom hook for managing ad creation form state
 * Extracts complex state management logic from the component
 */
export function useAdFormState(): UseAdFormStateReturn {
  // Form management
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "",
      subcategory: "",
      price: "",
      contactNumber: "",
      location: "",
      images: [],
      tags: []
    }
  })

  const { register, handleSubmit, setValue, watch, formState: { errors }, getValues } = form

  // UI state
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null)
  const [locationName, setLocationName] = useState("")
  const [isLocating, setIsLocating] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState("")
  const [selectedSubcategory, setSelectedSubcategory] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [openCategory, setOpenCategory] = useState(false)
  const [openSubcategory, setOpenSubcategory] = useState(false)
  const [nlpInput, setNlpInput] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<{ tags: string[], smartTags: string[] }>({
    tags: [],
    smartTags: []
  })
  const [analysisSuccess, setAnalysisSuccess] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [onboardRequired, setOnboardRequired] = useState(false)

  // Derived state
  const { title, description, subcategory } = watch()

  // Effects
  useEffect(() => {
    // Auto-suggest tags based on title and description
    if (title || description) {
      const timeoutId = setTimeout(() => {
        fetchAISuggestions()
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [title, description])

  // Actions
  const resetForm = useCallback(() => {
    form.reset()
    setSelectedCategory("")
    setSelectedSubcategory("")
    setSelectedTags([])
    setSuggestedTags([])
    setImageFiles([])
    setImagePreviews([])
    setNlpInput("")
    setAnalysis({ tags: [], smartTags: [] })
    setCoordinates(null)
    setLocationName("")
    setOnboardRequired(false)
    setAnalysisError(null)
  }, [form])

  const handleImageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const newFiles = [...imageFiles, ...files]
    setImageFiles(newFiles)

    // Create previews
    const newPreviews = files.map(file => URL.createObjectURL(file))
    setImagePreviews([...imagePreviews, ...newPreviews])
  }, [imageFiles, imagePreviews])

  const removeImage = useCallback((index: number) => {
    const newFiles = imageFiles.filter((_, i) => i !== index)
    const newPreviews = imagePreviews.filter((_, i) => i !== index)
    
    // Clean up object URLs
    URL.revokeObjectURL(imagePreviews[index])
    
    setImageFiles(newFiles)
    setImagePreviews(newPreviews)
  }, [imageFiles, imagePreviews])

  const handleCategorySelect = useCallback((category: string) => {
    setSelectedCategory(category)
    setValue('category', category)
    setSelectedSubcategory("")
    setValue('subcategory', "")
    setSelectedTags([])
    setValue('tags', [])
  }, [setValue])

  const handleSubcategorySelect = useCallback((subcategory: string) => {
    setSelectedSubcategory(subcategory)
    setValue('subcategory', subcategory)
    setSelectedTags([])
    setValue('tags', [])
  }, [setValue])

  const toggleTag = useCallback((tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(newTags)
    setValue('tags', newTags)
    return newTags
  }, [selectedTags, setValue])

  const fetchAISuggestions = useCallback(async () => {
    if (!title && !description) return
    
    setIsLoadingTags(true)
    try {
      const combinedText = `${title} ${description}`.trim()
      const analysis = await witService.analyzeText(combinedText)
      const suggestions = analysis.tags || []
      
      // Filter suggestions based on current category/subcategory
      const categoryTags = selectedCategory && selectedSubcategory 
        ? (CATEGORY_STRUCTURE as any)[selectedCategory]?.subcategories?.[selectedSubcategory]?.tags || []
        : []
      
      const filteredSuggestions = suggestions.filter((tag: string) => {
        if (categoryTags.length === 0) return true
        return categoryTags.some((catTag: string) => 
          catTag.toLowerCase().includes(tag.toLowerCase()) || 
          tag.toLowerCase().includes(catTag.toLowerCase())
        )
      })
      
      setSuggestedTags(filteredSuggestions.slice(0, 10))
    } catch (error) {
      console.error('Failed to fetch AI suggestions:', error)
      setSuggestedTags([])
    } finally {
      setIsLoadingTags(false)
    }
  }, [title, description, selectedCategory, selectedSubcategory])

  const checkOnboarding = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_account_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (!profile?.stripe_account_id) {
        setOnboardRequired(true)
      }
    } catch (error) {
      console.error('Failed to check onboarding status:', error)
    }
  }, [])

  return {
    // Form state
    form,
    register,
    handleSubmit,
    setValue,
    watch,
    errors,
    getValues,
    
    // UI state
    imageFiles,
    imagePreviews,
    isSubmitting,
    showMap,
    coordinates,
    locationName,
    isLocating,
    selectedCategory,
    selectedSubcategory,
    selectedTags,
    suggestedTags,
    isLoadingTags,
    openCategory,
    openSubcategory,
    nlpInput,
    isAnalyzing,
    analysis,
    analysisSuccess,
    analysisError,
    onboardRequired,
    
    // Actions
    setImageFiles,
    setImagePreviews,
    setIsSubmitting,
    setShowMap,
    setCoordinates,
    setLocationName,
    setIsLocating,
    setSelectedCategory,
    setSelectedSubcategory,
    setSelectedTags,
    setSuggestedTags,
    setIsLoadingTags,
    setOpenCategory,
    setOpenSubcategory,
    setNlpInput,
    setIsAnalyzing,
    setAnalysis,
    setAnalysisSuccess,
    setAnalysisError,
    setOnboardRequired,
    resetForm,
    handleImageChange,
    removeImage,
    handleCategorySelect,
    handleSubcategorySelect,
    toggleTag,
    fetchAISuggestions,
    checkOnboarding
  }
}