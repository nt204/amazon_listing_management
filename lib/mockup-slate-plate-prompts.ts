import type { ParsedDimensions } from "./mockup-types";

/**
 * Detailed prompt concepts for Slate Plate / Photo Slate Plaque (7 Amazon POD Images)
 * Extracted into a dedicated module for maintainability, debugging, and universal theme adaptability.
 */
export function getSlatePlateConcept(
  promptKey: string,
  dimensions: ParsedDimensions,
): string | null {
  const strictTypographyLock = `
STRICT ZERO-SMUDGE VECTOR-SHARP TYPOGRAPHY LOCK:
- Preserve 100% exact printed design graphics, illustrations, logo, text, typography, layout, and original colors from Image 1.
- All printed text and lettering on the slate surface MUST BE RAZOR-SHARP, HIGH-CONTRAST, CRISP, AND FULLY LEGIBLE.
- ABSOLUTELY NO SMUDGING, NO BLURRY LETTERS, NO FAULTY SPELLING, NO MELTED FONTS, AND NO ARTIFICIAL TEXT DISTORTION!`;

  const strictSlateMaterialLock = `
STRICT SLATE STONE & CHISELED EDGE FIDELITY:
- Preserve 100% exact natural slate stone texture, rough chiseled rock edges, square/rectangular plaque shape, black display stand, and smooth printed surface from Image 1.
- DO NOT default to smooth glass, acrylic, plastic, ceramic tile, or wood! Maintain authentic dark chiseled slate stone texture along all outer borders.`;

  const strictNoCountryOrWarHallucinationLock = `
STRICT NO HALLUCINATED COUNTRY OR WAR NAMES ON MODEL CLOTHING & ACCESSORIES:
- ABSOLUTELY DO NOT ADD ANY SPECIFIC COUNTRY NAMES, STATE NAMES, OR SPECIFIC WAR/CAMPAIGN NAMES (such as "VIETNAM", "VIETNAM VETERAN", "WWII", "IRAQ", "AFGHANISTAN", etc.) ON HUMAN MODEL HATS, CAPS, SHIRTS, OR CLOTHING UNLESS THAT EXACT WORD IS EXPLICITLY PRINTED ON IMAGE 1!
- All human model hats, caps, shirts, and apparel MUST BE PLAIN, UNBRANDED, AND TEXT-FREE (e.g. a plain black/navy cap or plain sweater without hallucinated text or country labels).`;

  switch (promptKey) {
    case "slate_main_white":
      return `HERO MAIN E-COMMERCE PRODUCT PHOTOGRAPHY (AMAZON MAIN IMAGE - IMAGE 1):
- CAMERA ANGLE: Clean full-front straight-on view (0 to 5 degree camera angle) for maximum visual clarity on Amazon search results.
- 100% PURE SOLID WHITE BACKGROUND (#FFFFFF, zero grey tint, zero background objects, clean soft contact shadow beneath stand).
- CENTERED ARRANGEMENT: Square/rectangular natural photo slate stone plaque from Image 1 standing upright on its included black display stand holder, occupying 85% of the frame.
- LIGHTING & MATERIAL ACCURACY: High-key studio lighting highlighting true printed artwork colors, smooth printed surface, and authentic dark chiseled slate stone rock edges.${strictTypographyLock}${strictSlateMaterialLock}`;

    case "slate_features_infographic":
      return `NATURAL STONE & WATERPROOF INFOGRAPHIC (AMAZON IMAGE 2 - MATCHING REFERENCE LAYOUT):
- BACKGROUND & ARRANGEMENT: Clean bright white studio table/countertop setting with soft window light, warm candle, and subtle decor in soft blur background.
- HUMAN HANDS INVOLVEMENT: Two realistic human hands entering frame, gently cupping and adjusting the slate stone plaque from Image 1 standing on its black display stand holder.
- LEFT SIDE FEATURE ICONS (3 circular icons with bold text labels):
  1) Slate Rock Icon: "NATURAL STONE"
  2) Quality Badge Icon: "HIGH-QUALITY PRINT"
  3) Water Shield Icon: "WATERPROOF"
- LIGHTING: Crisp macro studio lighting illuminating the chiseled stone borders and vivid printed design.${strictTypographyLock}${strictSlateMaterialLock}`;

    case "slate_dimensions_size":
      return `PRODUCT SIZE & 3D DIMENSIONS INFOGRAPHIC (AMAZON IMAGE 3):
- BACKGROUND: Clean concrete/slate grey or marble studio background wall.
- CENTER ARRANGEMENT: The natural photo slate plaque from Image 1 standing upright on its black display stand holder.
- TOP/BOTTOM HEADER: Bold typography reading "PRODUCT SIZE & SPECIFICATIONS".
- DIMENSION LINES:
  ${dimensions.length ? `- Vertical height dimension line labeled "${dimensions.length}"` : "- Do not invent a height measurement when none is supplied in the Trello description."}
  ${dimensions.width ? `- Base width dimension line labeled "${dimensions.width}"` : "- Do not invent a width measurement when none is supplied in the Trello description."}
  ${dimensions.thickness ? `- Thickness dimension callout labeled "${dimensions.thickness}"` : "- Omit the numeric thickness callout when thickness is not supplied in the Trello description."}
- FEATURE CALLOUT TEXT (Left or Right side icons):
  * "Authentic Chiseled Slate Stone"
  * "Display Stand Included"
  * "Fade-Resistant UV Print"
  * "Waterproof & Easy to Clean"${strictTypographyLock}${strictSlateMaterialLock}`;

    case "slate_front_back_stack":
      return `FRONT & BACK SLATE TEXTURE FLAT-LAY (AMAZON IMAGE 4 - MATCHING REFERENCE LAYOUT):
- CAMERA ANGLE: 90-degree top-down flat-lay photograph looking straight down at a rustic natural wooden tabletop surface.
- STACKED SLATE ARRANGEMENT:
  1) Top: The printed photo slate plaque from Image 1 sitting prominently on top of 2-3 stacked raw dark grey chiseled slate stone plates underneath.
  2) Shows the raw dark chiseled slate stone back texture and rough rock borders clearly.
- CALLOUT POINTER LINES WITH SOLID DOTS:
  - Pointer line to top printed surface labeled: "FRONT"
  - Pointer line to underlying dark raw slate stone plate labeled: "BACK"
- LIGHTING & ATMOSPHERE: Warm natural daylight, soft green leaves in corner, rich stone texture contrast.${strictTypographyLock}${strictSlateMaterialLock}`;

    case "slate_home_decor_lifestyle":
      return `HOME DECOR LIFESTYLE DISPLAY (AMAZON IMAGE 5):
- ENVIRONMENT: Cozy living room fireplace mantel, wooden study desk, bookshelf, or bedside table setting with a warm lamp or plant.
- PRODUCT ARRANGEMENT: The photo slate plaque from Image 1 standing on its black display stand holder, naturally integrated into the home decor scene.
- ATMOSPHERE: Warm natural daylight, soft shallow depth of field, authentic home decor commercial photography.${strictTypographyLock}${strictSlateMaterialLock}`;

    case "slate_gifting_emotion":
      return `MEANINGFUL TRIBUTE & GIFTING LIFESTYLE (AMAZON IMAGE 6 - MATCHING REFERENCE LAYOUT):
- AUTOMATIC UNIVERSAL THEME & RECIPIENT ADAPTABILITY: AI Vision scans Image 1 to detect recipient and theme (e.g. Bus Driver, Teacher, Graduate, Mom/Dad, Memorial, Family, Pet Lover, Military/Soldier Tribute):
  * Shows an authentic lifestyle scene with a smiling recipient/model matching THAT SPECIFIC THEME (e.g. smiling graduate hugging family, proud recipient, smiling mom/teacher).
  * If a military or soldier theme is detected from Image 1, show a proud model in PLAIN, TEXT-FREE civilian or unbranded clothing. DO NOT add "VIETNAM VETERAN" or any specific country text on hats/clothing unless printed on Image 1!
- BOTTOM CALLOUT BANNER: Subtle banner with elegant script typography reading: "A tribute gift for [theme/recipient]" (e.g. "A tribute gift for school bus drivers" or "A meaningful gift for loved ones"). Do NOT add any specific country or war names to the banner unless printed on Image 1.
- PRODUCT ARRANGEMENT: The photo slate plaque from Image 1 standing gracefully on its display stand in the foreground/side.${strictTypographyLock}${strictSlateMaterialLock}${strictNoCountryOrWarHallucinationLock}`;

    case "slate_packaging_box":
      return `PACKAGE INCLUDED & RETAIL GIFT BOX FLAT-LAY (AMAZON IMAGE 7):
- CAMERA ANGLE: 90-degree top-down flat-lay photograph looking straight down at a studio surface.
- ARRANGEMENT: The photo slate plaque from Image 1 displayed alongside its black display stand holder and protective foam packaging box. DO NOT include any greeting card, thank-you card, envelope, or extra paper cards.
- PLAIN UNBRANDED PACKAGING BOX (STRICT ZERO PATTERNS OR TEXT ON BOX):
  * The protective packaging gift box MUST BE COMPLETELY PLAIN AND SOLID COLORED (e.g. solid matte black, plain craft brown, or plain solid white).
  * ABSOLUTELY NO PATTERNS, NO DECORATIVE PRINTS, NO ARTWORK, NO LOGOS, NO BRAND NAMES, AND NO TEXT OF ANY KIND ON THE BOX SURFACE! The box exterior is 100% BLANK and UNBRANDED.
- TEXT CALLOUT: "PACKAGE INCLUDED: 1x Photo Slate Plaque, 1x Display Stand, 1x Protective Box".${strictTypographyLock}${strictSlateMaterialLock}`;

    default:
      return null;
  }
}
