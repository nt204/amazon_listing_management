import type { ParsedDimensions } from "./mockup-types";

/**
 * Detailed prompt concepts for Bullet Tumbler (7 Amazon POD Images)
 * Extracted into a dedicated module for maintainability, debugging, and universal theme adaptability.
 */
export function getBulletTumblerConcept(
  promptKey: string,
  dimensions: ParsedDimensions,
): string | null {
  const capacity = dimensions.capacity || "17oz";
  const capacityUpper = capacity.toUpperCase();
  const strictTypographyLock = `
STRICT ZERO-SMUDGE VECTOR-SHARP TYPOGRAPHY LOCK:
- Preserve 100% exact printed design graphics, illustrations, logo, text, typography, layout, and original colors from Image 1.
- All printed text and lettering on the tumbler body MUST BE RAZOR-SHARP, HIGH-CONTRAST, CRISP, AND FULLY LEGIBLE.
- ABSOLUTELY NO SMUDGING, NO BLURRY LETTERS, NO FAULTY SPELLING, NO MELTED FONTS, AND NO ARTIFICIAL TEXT DISTORTION ON THE BOTTLE!
CRITICAL BOTTLE GEOMETRY & SILHOUETTE LOCK (DO NOT REDESIGN OR ALTER BOTTLE SHAPE):
- Preserve 100% exact physical silhouette contour shape, straight vertical cylindrical body walls, distinct bullet casing shoulder angle, metallic/matte finish, and original bottle color from Image 1.
- ABSOLUTELY DO NOT TAPER, CURVE, BULGE, BEND, OR REDESIGN THE TUMBLER INTO A SLOPED WATER FLASK OR SPORTS BOTTLE! The tumbler is a straight-walled bullet tumbler.
- ABSOLUTELY NO ASYMMETRICAL WARPING, NO DENTED BOTTLE SIDES, NO MELTED CONTOURS, AND NO DEFORMED BOTTLE LINES!`;

  const strictSingleFaceLock = `
STRICT SINGLE FRONT ARTWORK VIEW LOCK (DO NOT SQUEEZE OR STUFF BOTH SIDES):
- Render ONLY THE SINGLE PRIMARY FRONT DESIGN FACE from Image 1 visible to the camera.
- ABSOLUTELY DO NOT CROWD, SQUEEZE, OVERLAP, OR STUFF BOTH FRONT AND BACK ARTWORKS (e.g. Nutrition Facts panel + Flag design) ONTO THE SAME FRONT PERSPECTIVE! Show clean, natural front-facing artwork projection as seen in Image 1.`;

  switch (promptKey) {
    case "bullet_insulation_box":
      return `UPGRADED VACUUM INSULATION & GIFT BOX INFOGRAPHIC (AMAZON IMAGE 2 - MATCHING REFERENCE LAYOUT):
- AUTOMATIC UNIVERSAL VISUAL THEME EVALUATION (ANY NICHE OR THEME): AI Vision scans Image 1 for the tumbler's exact design theme (whether Tactical/Patriotic, Outdoors, Fishing, Golf, Biker, Profession, Gifting, Sports, Pet Lover, Seasonal, etc.) and complements the studio gift scene with subtle props matching that specific niche.
- BACKGROUND: Concrete slate grey texture background with marble countertop surface.
- TOP-LEFT HEADER: Large bold black title text reading "UPGRADED" with sub-header text "Vacuum Insulation".
- BOTTLE & BOX ARRANGEMENT:
  1) Center: The open bullet-shaped tumbler from Image 1 standing vertically with top cap detached, showing smooth stainless steel bottle neck.
  2) Right: A premium black marble retail gift box standing upright with gold foil bullet tumbler outline drawing, logo, and gold text reading "BULLET TUMBLER", "${capacity}", "11 HRS COLD", "2 DAYS ICED", "6 HRS HOT".
  3) Left & Disassembled Components: Detached shiny metallic gold bullet head cap sitting on tabletop, and detached inner white push-button leak-proof lid with blue button.
- CALLOUT POINTER LINES WITH SOLID RED/BLACK DOTS:
  - Pointer line to bottle neck: "Smooth Inner Surface Easy to Clean"
  - Pointer line to inner lid: "BPA FREE LEAK PROOF LID"
  - Pointer line to bottle bottom base: "304 STAINLESS STEEL"
  - Pointer line to gift box: "BOX"
- BOTTOM SUMMARY METRICS: "11 HRS COLD | 2 DAYS ICED | 6 HRS HOT".${strictTypographyLock}${strictSingleFaceLock}`;

    case "bullet_capacity_size":
      return `${capacityUpper} CAPACITY & 3D DIMENSION INFOGRAPHIC (AMAZON IMAGE 3 - MATCHING REFERENCE LAYOUT):
- BACKGROUND: Clean concrete/slate grey texture wall background.
- TOP-LEFT HEADER: Large bold gold and black typography reading "${capacityUpper} CAPACITY".
- CENTER TUMBLER: The bullet tumbler from Image 1 standing vertically in full height.
- DIMENSION LINES:
  - Vertical height dimension line on right labeled "${dimensions.length || '11"'}".
  - Base width dimension line at bottom labeled "${dimensions.width || '2.6"'}".
- LEFT SIDE FEATURE ICONS (4 circular icons with text):
  1) Shield icon: "Safety Guaranteed"
  2) Leaf icon: "BPA Free Lid"
  3) Snowflake icon with blue text: "Keep Cold For 12 H"
  4) Flame icon with red text: "Keep Hot For 6 H"
- BODY CUTAWAY GRAPHIC: Translucent shield-shaped cutaway graphic on the bottle body showing icy cold drink with ice cubes on the left (blue accent) and hot dark coffee with steam on the right (red accent).${strictTypographyLock}${strictSingleFaceLock}`;

    case "bullet_press_lid_pour":
      return `DOUBLE WALL INSULATION & PRESS TO OPEN LID INFOGRAPHIC (AMAZON IMAGE 4 - MATCHING REFERENCE LAYOUT):
- REALISTIC HUMAN HANDS INVOLVEMENT (MUST SHOW REAL HUMAN HANDS & FINGERS):
  1) Upper human hand entering frame, holding the top of the tumbler from Image 1 and pressing down on the blue "OPEN" push button of the inner lid with an index finger.
  2) Lower human hand entering from below, gently holding the detached metallic gold bullet cap, receiving the stream of hot dark coffee.
- INSET CIRCLE DIAGRAM (TOP-LEFT): A circular inset diagram showing a top-down macro close-up of the white/blue push-button inner lid mechanism labeled "OPEN".
- ACTION SCENE: Hot dark steaming coffee pouring smoothly from the open inner lid spout down into the gold bullet cap cup held by human hands below.
- TOP HEADER TEXT: "DOUBLE WALL INSULATION - Keeps drinks hot or cold all day long."
- HIGH-KEY LIGHTING: Crisp studio macro lighting highlighting liquid stream, human hands, metallic gold bullet cap, and 304 stainless steel bottle finish.${strictTypographyLock}${strictSingleFaceLock}`;

    case "bullet_outdoor_camping":
      return `OUTDOOR CAMPING COFFEE POURING LIFESTYLE (AMAZON IMAGE 5 - TWO PEOPLE POURING COFFEE):
- STRICT BOTTLE SHAPE & COLOR FIDELITY (DO NOT ALTER SHAPE OR COLOR):
  1) Preserve 100% exact physical silhouette contour shape, straight cylindrical body, bullet casing shoulder, bottle color, and material finish from Image 1!
  2) DO NOT distort or bulge the bullet tumbler shape into a curved water bottle or thermos!
- PLAIN UNPRINTED CAMPING MUG (STRICT NO TEXT ON RECEIVING MUG):
  The stainless steel camping mug receiving the coffee MUST BE A CLEAN, PLAIN, SOLID UNPRINTED STAINLESS STEEL MUG. ABSOLUTELY NO TEXT, NO LOGO, AND NO ARTWORK PRINTED ON THE CAMPING MUG!
- TWO PEOPLE INTERACTION (MUST SHOW TWO PEOPLE SHARING COFFEE IN CAMPING SCENE):
  1) Person 1 (on left, wearing cozy plaid flannel jacket): Holding the bullet tumbler from Image 1 horizontally tilted slightly downward at a 15-20 degree pouring angle.
  2) Person 2 (on right): Holding the plain unprinted stainless steel camping mug with blue handles in their hand, receiving the poured coffee.
- COMPOSITION & BOTTLE ORIENTATION (EXACT MATCH FOR REFERENCE IMAGE):
  1) The bullet tumbler's printed design artwork, lettering, and graphics from Image 1 face DIRECTLY FORWARD TOWARD THE CAMERA, rendered with crisp vector sharpness naturally curving along the metallic cylindrical surface with realistic studio highlights.
  2) A steady, smooth stream of hot dark coffee flows gracefully from the bottle spout directly into the plain mug held by Person 2.
- NATURAL HUMAN HAND GRIPS (NATURAL 5-FINGER HAND ANATOMY):
  1) Person 1's hand gently grips the upper body of the bullet tumbler. Fingers wrap naturally and cleanly around the metallic bottle WITHOUT overlapping, smudging, obscuring, or distorting the printed artwork design!
  2) Anatomically correct hands: exactly 5 fingers per hand, zero extra fingers, zero distorted joints, zero artificial hand glitches.
- BACKGROUND & ENVIRONMENT: Authentic outdoor camping scene (blue camping tent in background, black backpack, wooden bench/outdoor table). Warm natural outdoor lighting, soft shallow depth of field.
- STRICT CORRECT TEXT ORIENTATION: All text and lettering on the bottle MUST face upright and readable from left to right. ABSOLUTELY NO upside-down text, NO reversed lettering, NO mirrored words, and NO distorted fonts!${strictTypographyLock}${strictSingleFaceLock}`;

    case "bullet_car_cupholder":
      return `CUP HOLDER FRIENDLY CAR TRAVEL LIFESTYLE (AMAZON IMAGE 6 - CLEAN LIFESTYLE PHOTOGRAPHY):
- CLEAN PURE LIFESTYLE PHOTOGRAPHY (ABSOLUTELY NO OVERLAY TEXT OR BANNERS):
  1) Pure clean lifestyle product photography inside a luxury vehicle center console.
  2) ABSOLUTELY NO OVERLAY TEXT BOXES, NO WHITE CALLOUT CARDS, NO GRAPHIC BANNERS, AND NO FLOATING TEXT ON THE IMAGE BACKGROUND!
- STRICT SINGLE FRONT ARTWORK VIEW (DO NOT WRAP OR STUFF BOTH SIDES):
  1) Display ONLY the main front artwork face from Image 1 towards the camera.
  2) ABSOLUTELY DO NOT CROWD, WRAP, OR STUFF THE BACK DESIGN (e.g. Nutrition Facts box) onto the front side! The sides of the tumbler should show clean metallic surface wrap around naturally.
- STRICT SYMMETRICAL BULLET SILHOUETTE LOCK (ZERO BOTTLE WARPING OR TAPERED REDESIGN):
  1) The bullet tumbler MUST PRESERVE ITS PERFECTLY STRAIGHT CYLINDRICAL SYMMETRICAL BODY AND BULLET SHOULDER CONTOUR FROM IMAGE 1.
  2) ABSOLUTELY DO NOT TAPER, CURVE, OR BEND THE BOTTLE INTO A SLOPED FLASK!
- GENTLE HAND TOUCH (DO NOT SQUEEZE BOTTLE):
  The driver's hand gently touches or rests near the bottle. DO NOT squeeze, dent, indent, or warp the bottle cylinder!
- REALISTIC HUMAN DRIVER HAND: Interior view of a modern luxury vehicle console with a human driver's hand reaching to place or hold the bullet tumbler from Image 1 securely in the center console cup holder.
- LIGHTING & ATMOSPHERE: Bright natural sunlight coming through the vehicle window, soft shallow depth of field.${strictTypographyLock}${strictSingleFaceLock}`;

    case "bullet_men_gifting":
      return `HERO LIFESTYLE & GIFTING PRESENTATION (AMAZON IMAGE 7 - UNIVERSAL THEME & RECIPIENT ADAPTIVE):
- AUTOMATIC UNIVERSAL VISUAL THEME & RECIPIENT EVALUATION (ANY RECIPIENT OR THEME): AI Vision scans Image 1 to evaluate the recipient and theme:
  * Male / Outdoors / Father / Husband / Biker / Military: Outdoor mountain vista or highway background, smiling handsome man wearing beanie & cozy sweater holding the tumbler. Footer banner: "COOLEST TUMBLER FOR MEN".
  * Female / Mom / Wife / Nurse / Teacher / Gift: Warm scenic outdoor, garden, or cozy living room background, smiling appealing woman holding the tumbler. Footer banner: "PERFECT GIFT FOR HER" or "COOLEST TUMBLER".
  * Golf / Sports / Pet Lover / Niche / Military Tribute: Natural outdoor or niche backdrop perfectly matching the artwork theme.
- REALISTIC HUMAN MODEL WITH SMILE: Inspiring, high-quality commercial lifestyle photography featuring a real human model holding the bullet tumbler from Image 1 in both hands.
- STRICT NO HALLUCINATED TEXT OR COUNTRY NAMES ON MODEL CLOTHING: All clothing, hats, beanies, caps, and apparel on the human model MUST BE PLAIN, UNBRANDED, AND TEXT-FREE. ABSOLUTELY DO NOT ADD "VIETNAM VETERAN", country names, or war names on model clothing/hats unless printed on Image 1!
- BOTTOM FOOTER BANNER: Bold white banner across the bottom with large black all-caps text reading "COOLEST TUMBLER FOR MEN" (or "PERFECT GIFT").${strictTypographyLock}${strictSingleFaceLock}`;

    default:
      return null;
  }
}
