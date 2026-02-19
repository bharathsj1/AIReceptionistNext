"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../../components/ui/dialog";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";

import type { BusinessProfileInput } from "../../../../lib/validators/businessProfile";
import { businessProfileSchema } from "../../../../lib/validators/businessProfile";
import {
  businessCategories,
  getPreviewBullets,
  getSubTypesForCategory,
} from "./businessTypes";

const defaultValues: BusinessProfileInput = {
  category: "",
  subType: "",
  customType: "",
  businessName: "",
};
const API_BASE = "https://aireceptionist-func.azurewebsites.net/api";

export const BusinessTypeForm = () => {
  const router = useRouter();
  const [subTypeSearch, setSubTypeSearch] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BusinessProfileInput>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues,
  });

  const category = watch("category");
  const subType = watch("subType");
  const categoryValue = category || undefined;
  const subTypeValue = subType || undefined;
  const showCustomField =
    category === "Other (Custom)" || subType === "Other (Custom)";

  const subTypeOptions = useMemo(() => {
    const options = getSubTypesForCategory(category);
    if (!subTypeSearch) return options;
    return options.filter((option) =>
      option.toLowerCase().includes(subTypeSearch.toLowerCase())
    );
  }, [category, subTypeSearch]);

  const previewBullets = useMemo(() => getPreviewBullets(category), [category]);

  useEffect(() => {
    setSubTypeSearch("");
    setValue("subType", "", { shouldValidate: true });
    if (category !== "Other (Custom)") {
      setValue("customType", "");
    }
  }, [category, setValue]);

  useEffect(() => {
    if (!showCustomField) {
      setValue("customType", "");
    }
  }, [setValue, showCustomField]);

  const handleSkip = () => {
    setSkipOpen(false);
    router.push("/onboarding/hours");
  };

  const onSubmit = async (values: BusinessProfileInput) => {
    const payload = {
      category: values.category,
      subType: values.subType,
      customType: values.customType?.trim() || null,
      businessName: values.businessName?.trim() || null,
    };

    try {
      const response = await fetch(`${API_BASE}/profile/business`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message || "Something went wrong while saving your profile."
        );
      }

      toast.success("Saved");
      router.push("/onboarding/hours");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save your business profile right now.";
      toast.error(message);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="border-slate-800/80 bg-slate-900/70 text-slate-100 shadow-xl shadow-slate-950/20">
        <CardHeader>
          <CardTitle className="text-xl">Business details</CardTitle>
          <CardDescription className="text-slate-400">
            Choose a category so we can personalize your AI receptionist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="category">Business Category</Label>
              <Select
                value={categoryValue}
                onValueChange={(value) =>
                  setValue("category", value, { shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="category"
                  aria-invalid={Boolean(errors.category)}
                >
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {businessCategories.map((categoryOption) => (
                    <SelectItem key={categoryOption} value={categoryOption}>
                      {categoryOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-sm text-rose-400">
                  {errors.category.message}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subTypeSearch">Search sub-types</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="subTypeSearch"
                  placeholder={
                    category
                      ? "Search within the selected category"
                      : "Select a category first"
                  }
                  value={subTypeSearch}
                  onChange={(event) => setSubTypeSearch(event.target.value)}
                  disabled={!category}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subType">Business Sub-Type</Label>
              <Select
                value={subTypeValue}
                onValueChange={(value) =>
                  setValue("subType", value, { shouldValidate: true })
                }
                disabled={!category}
              >
                <SelectTrigger id="subType" aria-invalid={Boolean(errors.subType)}>
                  <SelectValue placeholder="Select a sub-type" />
                </SelectTrigger>
                <SelectContent>
                  {subTypeOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-400">
                      No matches. Try a different search.
                    </div>
                  ) : (
                    subTypeOptions.map((subTypeOption) => (
                      <SelectItem key={subTypeOption} value={subTypeOption}>
                        {subTypeOption}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {errors.subType && (
                <p className="text-sm text-rose-400">
                  {errors.subType.message}
                </p>
              )}
            </div>

            {showCustomField && (
              <div className="grid gap-2">
                <Label htmlFor="customType">Custom business type</Label>
                <Input
                  id="customType"
                  placeholder="Describe your business"
                  {...register("customType")}
                />
                {errors.customType && (
                  <p className="text-sm text-rose-400">
                    {errors.customType.message}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="businessName">Business Name (Optional)</Label>
              <Input
                id="businessName"
                placeholder="Your business name"
                {...register("businessName")}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Continue"
                )}
              </Button>

              <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={isSubmitting}>
                    Skip for now
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Skip this step?</DialogTitle>
                    <DialogDescription>
                      You can always add your business type later. We'll use
                      defaults for now.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setSkipOpen(false)}>
                      Stay here
                    </Button>
                    <Button type="button" onClick={handleSkip}>
                      Skip and continue
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/70 text-slate-100">
        <CardHeader>
          <CardTitle className="text-lg">What we'll configure</CardTitle>
          <CardDescription className="text-slate-400">
            {category ? `Based on ${category}` : "Based on your selection"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {previewBullets.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};
