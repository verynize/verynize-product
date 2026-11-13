figcraft perf (macos release build; ms unless noted; mean of several runs)

| operation                                       | 1000 layers | 10000 layers | 50000 layers | 100000 layers |
| ----------------------------------------------- | ----------: | -----------: | -----------: | ------------: |
| build + normalize (like open)                   |      210.50 |        48.77 |       293.57 |        601.78 |
| save .figcraft                                  |        2.00 |        17.66 |        88.13 |        176.14 |
| load .figcraft                                  |        3.39 |        34.45 |       175.53 |        366.07 |
| render 1440×900 @100%                           |        2.71 |         2.85 |         3.30 |          4.39 |
| render 1440×900 zoomed to fit                   |        4.84 |         6.11 |         9.38 |         15.81 |
| render 1440×900 zoomed to fit, exact (no LOD)   |        4.68 |        19.43 |        75.45 |        141.58 |
| render 1440×900 zoomed out (2× fit)             |        3.30 |        11.15 |         9.76 |         10.68 |
| pan 40 px @100% (retained)                      |        0.63 |         0.67 |         0.81 |          1.06 |
| pan 40 px zoomed out (retained)                 |        0.63 |         1.94 |         1.56 |          1.84 |
| move one layer, re-render @100% (retained)      |        0.03 |         0.24 |         2.53 |          5.53 |
| move one layer, re-render zoomed out (retained) |        0.05 |         0.25 |         2.75 |          5.53 |
| hit test (µs each)                              |       16.23 |        32.25 |       119.12 |        224.09 |
| boolean of 24: drag frame, top operand          |        0.64 |         0.33 |         0.33 |          0.33 |
| boolean of 24: drag frame, bottom operand       |        6.18 |         6.02 |         5.98 |          5.92 |
| hover pointer move (µs each)                    |       16.48 |        32.94 |       118.56 |        224.84 |
| node.set fill on one layer                      |        0.04 |         0.01 |         0.01 |          0.01 |
| transform.move one layer                        |        0.00 |         0.01 |         0.01 |          0.01 |
| edit text in an auto layout frame               |        0.02 |         0.01 |         0.01 |          0.02 |
| edit main component (all instances follow)      |        0.13 |         1.70 |        12.31 |         28.10 |
| undo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| redo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| drag preview frame (one layer)                  |        0.00 |         0.00 |         0.01 |          0.01 |
| normalize after a one-node edit                 |        0.00 |         0.00 |         0.00 |          0.00 |
| document.inspect (depth 8)                      |        3.72 |        43.92 |       229.81 |        483.95 |
| select all + move every screen                  |        0.16 |         2.03 |        11.36 |         25.14 |
