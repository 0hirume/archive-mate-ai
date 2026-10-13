import { AutoTokenizer, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { catalogPath } from "./settings.ts";

export const embeddingModel = "Xenova/multilingual-e5-small";
export const embeddingRevision = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const embeddingDimensions = 384;
export const embeddingIdentity = `${embeddingModel}:${embeddingRevision}:q8:mean:normalized:2`;
export const modelDirectory = resolve(dirname(catalogPath), "models");

export type Tokenizer = FeatureExtractionPipeline["tokenizer"];

let extraction: Promise<FeatureExtractionPipeline> | null = null;
let tokenizer: Promise<Tokenizer> | null = null;

export function localModelAvailable(): boolean {
    return (
        existsSync(resolve(modelDirectory, embeddingModel, embeddingRevision, "onnx/model_quantized.onnx")) &&
        existsSync(resolve(modelDirectory, embeddingModel, embeddingRevision, "tokenizer.json"))
    );
}

export async function loadExtraction(download = false): Promise<FeatureExtractionPipeline> {
    if (!extraction) {
        extraction = pipeline("feature-extraction", embeddingModel, {
            revision: embeddingRevision,
            dtype: "q8",
            device: "cpu",
            cache_dir: modelDirectory,
            local_files_only: !download,

            progress_callback: download
                ? (progress) => {
                      if (progress.status === "initiate" || progress.status === "done" || progress.status === "ready") {
                          console.info(JSON.stringify({ download: progress }));
                      }
                  }
                : undefined,
        }).catch((error: unknown) => {
            extraction = null;
            throw error;
        });
    }

    return extraction;
}

export async function loadTokenizer(): Promise<Tokenizer> {
    if (!tokenizer) {
        tokenizer = AutoTokenizer.from_pretrained(embeddingModel, {
            revision: embeddingRevision,
            cache_dir: modelDirectory,
            local_files_only: true,
        }).catch((error: unknown) => {
            tokenizer = null;
            throw error;
        });
    }

    return tokenizer;
}
