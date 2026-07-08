#pragma once

#include <Arduino.h>

/**
 * @brief Setup Motor Expansion
 * 
 */
void start_motors();

/**
 * @brief Drive Motors with Expansion Board
 * 
 * @param m1a Motor 1A PWM (0 - 255)
 * @param m1b Motor 1B PWM (0 - 255)
 * @param m2a Motor 2A PWM (0 - 255)
 * @param m2b Motor 2B PWM (0 - 255)
 */
void drive_motors(int M1A, int M1B, int M2A, int M2B);

/**
 * @brief Drive Motors with Expansion Board
 * 
 * @param dir Movement Direction (F, B, L, R, S)
 * @param speed Motor Speed (0 - 255)
 */
void runMotor(String dir, int speed);
