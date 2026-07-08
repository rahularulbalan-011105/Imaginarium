#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "pitches.h"
#include "Subo.h"

Adafruit_NeoPixel strip(SUBO_LED_NUM, SUBO_LED_PIN, NEO_GRB + NEO_KHZ800);
bool buzzerUsed = false;

const uint8_t PROGMEM gamma8[] = {
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2,
    2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5,
    5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10,
    10, 10, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 15, 15, 16, 16,
    17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 24, 24, 25,
    25, 26, 27, 27, 28, 29, 29, 30, 31, 32, 32, 33, 34, 35, 35, 36,
    37, 38, 39, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 50,
    51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66, 67, 68,
    69, 70, 72, 73, 74, 75, 77, 78, 79, 81, 82, 83, 85, 86, 87, 89,
    90, 92, 93, 95, 96, 98, 99, 101, 102, 104, 105, 107, 109, 110, 112, 114,
    115, 117, 119, 120, 122, 124, 126, 127, 129, 131, 133, 135, 137, 138, 140, 142,
    144, 146, 148, 150, 152, 154, 156, 158, 160, 162, 164, 167, 169, 171, 173, 175,
    177, 180, 182, 184, 186, 189, 191, 193, 196, 198, 200, 203, 205, 208, 210, 213,
    215, 218, 220, 223, 225, 228, 231, 233, 236, 239, 241, 244, 247, 249, 252, 255};

int tone1_m[] = {

    REST,
    NOTE_G5,
    NOTE_FS5,
    NOTE_F5,
    NOTE_DS5,
    NOTE_E5,
    REST,
    NOTE_GS4,
    NOTE_A4,
    NOTE_C4,
    REST,
    NOTE_A4,
    NOTE_C5,
    NOTE_D5,
    REST,
    NOTE_DS5,
    REST,
    NOTE_D5,
    NOTE_C5,
    REST,

};

int tone1_d[] = {

    4,
    8,
    8,
    8,
    4,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    4,
    4,
    8,
    4,
    2,
    2,
};

int tone2_m[] = {
    REST, 459, 929, 701, 1866, REST};

int tone2_d[] = {
    4, 8, 8, 8, 8, 4};

int tone3_m[] = {
    REST, 518, 487, 459, 430, 408, 386, 351, REST};

float tone3_d[] = {
    4, 4, 2, 4, 2, 4, 4, 0.5, 4};

int tone4_m[] = {
    NOTE_C4, NOTE_C4,
    NOTE_D4, NOTE_C4, NOTE_F4,
    NOTE_E4, NOTE_C4, NOTE_C4,
    NOTE_D4, NOTE_C4, NOTE_G4,
    NOTE_F4, NOTE_C4, NOTE_C4,

    NOTE_C5, NOTE_A4, NOTE_F4,
    NOTE_E4, NOTE_D4, NOTE_AS4, NOTE_AS4,
    NOTE_A4, NOTE_F4, NOTE_G4,
    NOTE_F4};

int tone4_d[] = {
    4, 8,
    4, 4, 4,
    2, 4, 8,
    4, 4, 4,
    2, 4, 8,

    4, 4, 4,
    4, 4, 4, 8,
    4, 4, 4,
    2};

int tone5_m[] = {
    NOTE_E5, NOTE_E5, NOTE_E5,
    NOTE_E5, NOTE_E5, NOTE_E5,
    NOTE_E5, NOTE_G5, NOTE_C5, NOTE_D5,
    NOTE_E5,
    NOTE_F5, NOTE_F5, NOTE_F5, NOTE_F5,
    NOTE_F5, NOTE_E5, NOTE_E5, NOTE_E5, NOTE_E5,
    NOTE_E5, NOTE_D5, NOTE_D5, NOTE_E5,
    NOTE_D5, NOTE_G5};

int tone5_d[] = {
    8, 8, 4,
    8, 8, 4,
    8, 8, 8, 8,
    2,
    8, 8, 8, 8,
    8, 8, 8, 16, 16,
    8, 8, 8, 8,
    4, 4};

// Subo Matrix Functions

/**
 * @brief LED Matrix Reversing. In SUBO, the matrix's first pin is in the bottom right corner,but the first led should be in the top left corner
 *
 * @param n LED Number
 * @return int Reversed LED Number
 */
int ledRev(int n)
{
    return map(n, 0, SUBO_LED_NUM - 1, SUBO_LED_NUM - 1, 0);
}

/**
 * @brief Initialize the Subo Matrix
 *
 */
void SuboMatrixInit()
{
    strip.begin();           // INITIALIZE NeoPixel strip object (REQUIRED)
    strip.show();            // Turn OFF all pixels ASAP
    strip.setBrightness(15); // Set BRIGHTNESS to about 1/5 (max = 255)
}

/**
 * @brief Subo Matrix Color Fill function
 *
 * @param r R component of the color
 * @param g G component of the color
 * @param b B component of the color
 */
void setAllLED(int r, int g, int b)
{
    for (int i = 0; i < strip.numPixels(); i++)
    {
        strip.setPixelColor(i, strip.Color(gamma8[r], gamma8[g], gamma8[b]));
    }
    strip.show();
}

/**
 * @brief Single LED color setting function
 *
 * @param n LED Number
 * @param r R component of the color
 * @param g G component of the color
 * @param b B component of the color
 */
void setSingleLED(int n, int r, int g, int b)
{
    uint32_t col = strip.Color(r, g, b);
    if (n <= strip.numPixels() && n > 0)
    {

        strip.setPixelColor(ledRev(n - 1), strip.Color(gamma8[r], gamma8[g], gamma8[b]));
        strip.show();
    }
}

/**
 * @brief Clear Subo Matrix
 *
 */
void stripclear()
{
    strip.clear();
    strip.show();
}

/**
 * @brief
 *
 * @param r R component of the color
 * @param g G component of the color
 * @param b B component of the color
 * @param wait Delay time
 */
void theaterChase(int r, int g, int b, int wait)
{
    uint32_t color = strip.Color(gamma8[r], gamma8[g], gamma8[b]);
    for (int a = 0; a < 10; a++)
    { // Repeat 10 times...
        for (int b = 0; b < 3; b++)
        {                  //  'b' counts from 0 to 2...
            strip.clear(); //   Set all pixels in RAM to 0 (off)
            // 'c' counts up from 'b' to end of strip in steps of 3...
            for (int c = b; c < strip.numPixels(); c += 3)
            {
                strip.setPixelColor(c, color); // Set pixel 'c' to value 'color'
            }
            strip.show(); // Update strip with new contents
            delay(wait);  // Pause for a moment
        }
    }
}

/**
 * @brief Rainbow animation function
 *
 * @param wait Delay time
 */
void rainbow(int wait)
{
    // Hue of first pixel runs 5 complete loops through the color wheel.
    // Color wheel has a range of 65536 but it's OK if we roll over, so
    // just count from 0 to 5*65536. Adding 256 to firstPixelHue each time
    // means we'll make 5*65536/256 = 1280 passes through this loop:
    for (long firstPixelHue = 0; firstPixelHue < 5 * 65536; firstPixelHue += 256)
    {
        // strip.rainbow() can take a single argument (first pixel hue) or
        // optionally a few extras: number of rainbow repetitions (default 1),
        // saturation and value (brightness) (both 0-255, similar to the
        // ColorHSV() function, default 255), and a true/false flag for whether
        // to apply gamma correction to provide 'truer' colors (default true).
        strip.rainbow(firstPixelHue);
        // Above line is equivalent to:
        // strip.rainbow(firstPixelHue, 1, 255, 255, true);
        strip.show(); // Update strip with new contents
        delay(wait);  // Pause for a moment
    }
}

/**
 * @brief Theather Rainbow Chase Animation function
 *
 * @param wait Delay time
 */
void theaterChaseRainbow(int wait)
{
    int firstPixelHue = 0; // First pixel starts at red (hue 0)
    for (int a = 0; a < 30; a++)
    { // Repeat 30 times...
        for (int b = 0; b < 3; b++)
        {                  //  'b' counts from 0 to 2...
            strip.clear(); //   Set all pixels in RAM to 0 (off)
            // 'c' counts up from 'b' to end of strip in increments of 3...
            for (int c = b; c < strip.numPixels(); c += 3)
            {
                // hue of pixel 'c' is offset by an amount to make one full
                // revolution of the color wheel (range 65536) along the length
                // of the strip (strip.numPixels() steps):
                int hue = firstPixelHue + c * 65536L / strip.numPixels();
                uint32_t color = strip.gamma32(strip.ColorHSV(hue)); // hue -> RGB
                strip.setPixelColor(c, color);                       // Set pixel 'c' to value 'color'
            }
            strip.show();                // Update strip with new contents
            delay(wait);                 // Pause for a moment
            firstPixelHue += 65536 / 90; // One cycle of color wheel over 90 frames
        }
    }
}

/**
 * @brief Fibbonnaci Breathing Function
 *
 */
void fibbBreathing()
{
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(2, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(2, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(3, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(4, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(2, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(3, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(4, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(5, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(6, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(2, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(3, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(4, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(5, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(6, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(7, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(8, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(9, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(10, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.clear();
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(1, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(2, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(3, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(4, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(5, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(6, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(7, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(8, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(9, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(10, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(11, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.setPixelColor(12, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
}

/**
 * @brief Half Split Animation function
 *
 */
void halfSplit()
{
    strip.setPixelColor(12, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(11, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(10, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(9, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(8, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(7, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(6, strip.Color(gamma8[222], gamma8[123], gamma8[18]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(5, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(12, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(4, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(11, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(3, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(10, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(2, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(9, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(1, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(8, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(0, strip.Color(gamma8[18], gamma8[201], gamma8[222]));
    strip.setPixelColor(7, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
    strip.setPixelColor(6, strip.Color(gamma8[0], gamma8[0], gamma8[0]));
    strip.show();
    vTaskDelay(150);
}

/**
 * @brief Subo Play LED Sequence
 * 
 * @param ID Sequence ID
 */
void playLEDSeq(int ID)
{
    if (ID == 1)
    {
        theaterChase(127, 0, 127, 50);
        stripclear();
    }
    else if (ID == 2)
    {
        rainbow(10);
        stripclear();
    }
    else if (ID == 3)
    {
        theaterChaseRainbow(50);
        stripclear();
    }
    else if (ID == 4)
    {
        theaterChase(245, 66, 245, 50);
        stripclear();
        theaterChase(66, 245, 69, 50);
        stripclear();
        theaterChase(227, 159, 34, 50);
        stripclear();
    }
    else if (ID == 5)
    {
        fibbBreathing();
        stripclear();
    }
    else if (ID == 6)
    {
        halfSplit();
        stripclear();
    }
}

// Subo Buzzer Functions

/**
 * @brief Function to play a Frequency for a duration on the buzzer
 *
 * @param f Frequency to play
 * @param dur Duration in seconds to play
 */
void playTone(float f, float dur)
{
    tone(SUBO_BUZZER_PIN, f, dur * 1000);
    buzzerUsed = true;
    int pauseBetweenNotes = dur * 1.30;
    vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
}

/**
 * @brief Stop buzzer if it is already playing
 *
 */
void stopBuzzer()
{
    if (buzzerUsed)
    {
        buzzerUsed = false;
        noTone(SUBO_BUZZER_PIN);
    }
}

/**
 * @brief Function to play a pre-programmed Buzzer Sequence
 * 
 * @param id Sequence ID
 */
void playBuzSeq(int id)
{
    buzzerUsed = true;
    // Play Preprogrammed tone
    if (id == 1)
    {
        int size = sizeof(tone1_d) / sizeof(int);

        for (int note = 0; note < size; note++)
        {
            // to calculate the note duration, take one second divided by the note type.
            // e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
            int duration = 1000 / tone1_d[note];
            // tone(SUBO_BUZZER_PIN, melody[note], duration);
            tone(SUBO_BUZZER_PIN, tone1_m[note], duration);

            // to distinguish the notes, set a minimum time between them.
            // the note's duration + 30% seems to work well:
            int pauseBetweenNotes = duration;
            vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
            // delay(pauseBetweenNotes);

            // stop the tone playing:
            noTone(SUBO_BUZZER_PIN);
        }
    }
    else if (id == 2)
    {
        int size = sizeof(tone2_d) / sizeof(int);

        for (int note = 0; note < size; note++)
        {
            // to calculate the note duration, take one second divided by the note type.
            // e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
            int duration = 1000 / tone2_d[note];
            // tone(SUBO_BUZZER_PIN, melody[note], duration);
            tone(SUBO_BUZZER_PIN, tone2_m[note], duration);

            // to distinguish the notes, set a minimum time between them.
            // the note's duration + 30% seems to work well:
            int pauseBetweenNotes = duration;
            vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
            // delay(pauseBetweenNotes);

            // stop the tone playing:
            noTone(SUBO_BUZZER_PIN);
        }
    }
    else if (id == 3)
    {
        int size = sizeof(tone3_d) / sizeof(int);

        for (int note = 0; note < size; note++)
        {
            // to calculate the note duration, take one second divided by the note type.
            // e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
            int duration = 1000 / tone3_d[note];
            // tone(SUBO_BUZZER_PIN, melody[note], duration);
            tone(SUBO_BUZZER_PIN, tone3_m[note], duration);

            // to distinguish the notes, set a minimum time between them.
            // the note's duration + 30% seems to work well:
            int pauseBetweenNotes = duration;
            vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
            // delay(pauseBetweenNotes);

            // stop the tone playing:
            noTone(SUBO_BUZZER_PIN);
        }
    }
    else if (id == 4)
    {
        int size = sizeof(tone4_d) / sizeof(int);

        for (int note = 0; note < size; note++)
        {
            // to calculate the note duration, take one second divided by the note type.
            // e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
            int duration = 1000 / tone4_d[note];
            // tone(SUBO_BUZZER_PIN, melody[note], duration);
            tone(SUBO_BUZZER_PIN, tone4_m[note], duration);

            // to distinguish the notes, set a minimum time between them.
            // the note's duration + 30% seems to work well:
            int pauseBetweenNotes = duration;
            vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
            // delay(pauseBetweenNotes);

            // stop the tone playing:
            noTone(SUBO_BUZZER_PIN);
        }
    }
    else if (id == 5)
    {
        int size = sizeof(tone5_d) / sizeof(int);

        for (int note = 0; note < size; note++)
        {
            // to calculate the note duration, take one second divided by the note type.
            // e.g. quarter note = 1000 / 4, eighth note = 1000/8, etc.
            int duration = 1000 / tone5_d[note];
            // tone(SUBO_BUZZER_PIN, melody[note], duration);
            tone(SUBO_BUZZER_PIN, tone5_m[note], duration);

            // to distinguish the notes, set a minimum time between them.
            // the note's duration + 30% seems to work well:
            int pauseBetweenNotes = duration;
            vTaskDelay(pauseBetweenNotes / portTICK_RATE_MS);
            // delay(pauseBetweenNotes);

            // stop the tone playing:
            noTone(SUBO_BUZZER_PIN);
        }
    }
}