#pragma once

#define SUBO_BUZZER_PIN 2

#define SUBO_LED_PIN 12
#define SUBO_LED_NUM 48

#define SUBO_BUTTONR 47
#define SUBO_BUTTONL 1

#define IO1 4 //ADC
#define IO2 39 
#define IO3 13
#define IO4 38
#define IO5 14 //ADC
#define IO6 48
#define IO7 42
#define IO8 5 //ADC
#define IO9 41 
#define IO10 40
#define IO11 6 //ADC
#define IO12 7 //ADC
#define IO13 15
#define IO14 16
#define IO15 17
#define IO16 18
#define IO17 8 //ADC
#define IO18 11
#define IO19 10 //ADC
#define IO20 9 //ADC
#define IO21 3 //ADC


/**
 * @brief Initialize the Subo Matrix
 *
 */
void SuboMatrixInit();

/**
 * @brief Subo Matrix Color Fill function
 *
 * @param r R component of the color
 * @param g G component of the color
 * @param b B component of the color
 */
void setAllLED(int r, int g, int b);

/**
 * @brief Single LED color setting function
 *
 * @param n LED Number
 * @param r R component of the color
 * @param g G component of the color
 * @param b B component of the color
 */
void setSingleLED(int n, int r, int g, int b);

/**
 * @brief Subo Play LED Sequence
 * 
 * @param ID Sequence ID
 */
void playLEDSeq(int ID);

/**
 * @brief Clear Subo Matrix
 *
 */
void stripclear();

/**
 * @brief Function to play a Frequency for a duration on the buzzer
 *
 * @param f Frequency to play
 * @param dur Duration in seconds to play
 */
void playTone(float f, float dur);

/**
 * @brief Stop buzzer if it is already playing
 *
 */
void stopBuzzer();

/**
 * @brief Function to play a pre-programmed Buzzer Sequence
 * 
 * @param id Sequence ID
 */
void playBuzSeq(int id);