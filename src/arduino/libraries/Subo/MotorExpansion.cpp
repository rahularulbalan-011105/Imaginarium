#include <Arduino.h>

#include "Subo.h"
#include "MotorExpansion.h"

static const int PWM_FREQ = 2000; // 2 kHz, good for DC motor drivers
static const int PWM_RES = 8;     // 8-bit resolution -> duty 0..255

static const int CH_M1A = 0;
static const int CH_M1B = 1;
static const int CH_M2A = 2;
static const int CH_M2B = 3;

void start_motors()
{
    pinMode(IO18, OUTPUT);
    pinMode(IO19, OUTPUT);
    pinMode(IO20, OUTPUT);
    pinMode(IO21, OUTPUT);

    // Setup LEDC (ESP32 Core v2.x uses ledcSetup + ledcAttachPin)
    ledcSetup(CH_M1A, PWM_FREQ, PWM_RES);
    ledcAttachPin(IO20, CH_M1A);

    ledcSetup(CH_M1B, PWM_FREQ, PWM_RES);
    ledcAttachPin(IO21, CH_M1B);

    ledcSetup(CH_M2A, PWM_FREQ, PWM_RES);
    ledcAttachPin(IO19, CH_M2A);

    ledcSetup(CH_M2B, PWM_FREQ, PWM_RES);
    ledcAttachPin(IO18, CH_M2B);
}

void drive_motors(int M1A, int M1B, int M2A, int M2B)
{
    ledcWrite(CH_M1A, M1A);
    ledcWrite(CH_M1B, M1B);
    ledcWrite(CH_M2A, M2A);
    ledcWrite(CH_M2B, M2B);
}

void runMotor(String dir, int speed)
{
    if (dir == "F")
    {
        ledcWrite(CH_M1A, speed);
        ledcWrite(CH_M1B, 0);
        ledcWrite(CH_M2A, speed);
        ledcWrite(CH_M2B, 0);
    }
    else if (dir == "B")
    {
        ledcWrite(CH_M1A, 0);
        ledcWrite(CH_M1B, speed);
        ledcWrite(CH_M2A, 0);
        ledcWrite(CH_M2B, speed);
    }
    else if (dir == "L")
    {
        ledcWrite(CH_M1A, speed);
        ledcWrite(CH_M1B, 0);
        ledcWrite(CH_M2A, 0);
        ledcWrite(CH_M2B, speed);
    }
    else if (dir == "R")
    {
        ledcWrite(CH_M1A, 0);
        ledcWrite(CH_M1B, speed);
        ledcWrite(CH_M2A, speed);
        ledcWrite(CH_M2B, 0);
    }
    else if (dir == "S")
    {
        ledcWrite(CH_M1A, 0);
        ledcWrite(CH_M1B, 0);
        ledcWrite(CH_M2A, 0);
        ledcWrite(CH_M2B, 0);
    }
    else
    {
        ESP_LOGE("MotorExpansion", "Invalid Direction");
    }
}