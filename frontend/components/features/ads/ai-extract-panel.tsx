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
      <Label htmlFor="listing-description-extraction" className="text-base font-semibold text-primary">
        {t('ad.quickCreate','Fill from description')}
      </Label>
      <div className="space-y-3">
        <Textarea
          id="listing-description-extraction"
          placeholder={t('ad.quickCreate.placeholder', 'Describe the item or service you need or offer. Include only details you know, such as model, condition and price.')}
          value={nlpInput}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[112px] bg-card text-card-foreground border-0 ring-1 ring-border focus:ring-2 focus:ring-blue-500 focus:border-0 resize-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {analysisSuccess && (
            <div className="flex items-center bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400 px-3 py-1 rounded-md text-sm">
              <CheckCircle className="h-4 w-4 mr-1" />
              {t('ad.quickCreate.analysisComplete','Draft ready to review')}
            </div>
          )}
          <Button type="button" onClick={onAnalyze} disabled={isAnalyzing || !nlpInput.trim()} className="min-h-11 w-full bg-primary text-primary-foreground sm:w-auto">
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('common.analyzing','Analyzing')}
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 mr-2" />
                {t('ad.quickCreate.extract','Extract details')}
              </>
            )}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('ad.quickCreate.help','Local text analysis suggests details found in your description. Add missing details and review all fields before publishing.')}
      </p>
    </div>
  )
}
