// Turn tracker — MPU6050 gyroscope (MPU6050_light library)
// Wiring: VCC -> 5V, GND -> GND, SCL -> SCL (A5), SDA -> SDA (A4)
// Spin the board about its Z axis: rotation rate in deg/s, heading in degrees.
#include <Wire.h>
#include <MPU6050_light.h>

MPU6050 mpu(Wire);

void setup() {
  Serial.begin(9600);
  Wire.begin();
  byte status = mpu.begin();
  while (status != 0) { }
  mpu.calcOffsets();               // keep it still while it calibrates
}

void loop() {
  mpu.update();
  Serial.print("GYRO X: "); Serial.print(mpu.getGyroX());
  Serial.print("  Y: ");    Serial.print(mpu.getGyroY());
  Serial.print("  Z: ");    Serial.print(mpu.getGyroZ());
  Serial.print("  | heading Z: "); Serial.println(mpu.getAngleZ());
  delay(100);
}
