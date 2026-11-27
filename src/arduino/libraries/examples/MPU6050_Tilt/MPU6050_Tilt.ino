// Tilt meter — MPU6050 accelerometer (MPU6050_light library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// Tilt the board (rotate it in the scene in Auto mode) and watch the angles.
#include <Wire.h>
#include <MPU6050_light.h>

MPU6050 mpu(Wire);

void setup() {
  Serial.begin(9600);
  Wire.begin();
  byte status = mpu.begin();
  Serial.print("MPU6050 status: ");
  Serial.println(status);
  while (status != 0) { }          // stop if the MPU6050 is not found
  Serial.println("Calculating offsets, do not move the MPU6050");
  delay(1000);
  mpu.calcOffsets();
  Serial.println("Done!");
}

void loop() {
  mpu.update();
  Serial.print("ACC X: "); Serial.print(mpu.getAccX());
  Serial.print("  Y: ");   Serial.print(mpu.getAccY());
  Serial.print("  Z: ");   Serial.print(mpu.getAccZ());
  Serial.print("  | angle X: "); Serial.print(mpu.getAngleX());
  Serial.print("  Y: ");          Serial.println(mpu.getAngleY());
  delay(250);
}
