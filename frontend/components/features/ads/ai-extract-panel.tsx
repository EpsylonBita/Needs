"use client";

import { Loader2, Wand2, CheckCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/contexts/i18n-context";

interface AiExtractPanelProps {
  nlpInput: string;
  isAnalyzing: boolean;
  analysisSuccess: boolean;
  onChange: (value: string) => void;
  onAnalyze: () => void;
}

export function AiExtractPanel({ nlpInput, isAnalyzing, analysisSuccess, onChange, onAnalyze }: AiExtractPanelProps) {
  const { t } = useI18n();
  return (
    <div className="mb-6 space-y-2">
      <Label className="text-base font-semibold text-blue-600 dark:text-blue-400">
        {t('ad.quickCreate','Quick Create with AI')}
      </Label>
      <div className="relative">
        <Textarea
          placeholder={t('ad.quickCreate.placeholder', 'Describe what you want to sell/buy, including details like brand, model, condition and price.')}
          value={nlpInput}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[100px] pr-24 bg-white dark:bg-gray-950 border-0 ring-1 ring-blue-200/50 dark:ring-blue-900/30 focus:ring-2 focus:ring-blue-500 focus:border-0 resize-none placeholder-gray-400"
        />
        <div className="absolute right-2 top-2 flex items-center gap-2">
          {analysisSuccess && (
            <div className="flex items-center bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 px-3 py-1 rounded-md text-sm">
              <CheckCircle className="h-4 w-4 mr-1" />
              {t('ad.quickCreate.analysisComplete','Analysis complete!')}
            </div>
          )}
          <Button type="button" onClick={onAnalyze} disabled={isAnalyzing || !nlpInput.trim()} className="bg-gradient-to-r from-blue-600 to-blue-500">
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.analyzing','Analyzing')}
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 mr-2" />
                {t('common.analyze','Analyze')}
              </>
            )}
          </Button>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        {t('ad.quickCreate.help','AI will extract title, price, phone number, category tags and specific item/brand tags from your description.')}
      </p>
    </div>
  )
}
