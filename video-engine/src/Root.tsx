import { Composition, getInputProps } from "remotion";
import React from "react";
import { KliperComposition, KliperCompositionProps } from "./KliperComposition";
import "./index.css";
import { loadFont } from "@remotion/google-fonts/Montserrat";

// Load font Montserrat
loadFont();

// Get props passed via CLI
const defaultProps: KliperCompositionProps = {
  clipVideoUrl: "",
  words: [],
  title: "VIRAL MOMENT",
  ctaText: undefined,
  campaignAsset: undefined,
  uniqueSpeakers: 1,
  dominantSpeaker: 0,
  clipDuration: 60,
};

// Merging CLI props with default props
const inputProps: KliperCompositionProps = { ...defaultProps, ...(getInputProps() as any) };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KliperComposition"
        component={KliperComposition as React.FC<any>}
        // If we want a dynamic duration, we would need to pass it in props,
        // or calculate it based on the words. Let's assume the clip is max 60s
        // We can pass durationInFrames from run_pipeline, or calculate here:
        // duration = clip.end_time - clip.start_time
        calculateMetadata={async ({ props }) => {
          const typedProps = props as unknown as KliperCompositionProps;
          // Calculate duration based on the last word's end time, 
          // or fallback to 60 seconds (1800 frames)
          let durationInFrames = 1800; 
          
          if (typedProps.words && typedProps.words.length > 0) {
            const lastWord = typedProps.words[typedProps.words.length - 1];
            // Add a small buffer of 0.5s at the end
            durationInFrames = Math.ceil((lastWord.end + 0.5) * 60); 
          }
          
          return {
            durationInFrames: Math.max(durationInFrames, 150),
            props
          };
        }}
        defaultProps={inputProps}
        fps={60}
        width={1080}
        height={1920}
      />
    </>
  );
};
