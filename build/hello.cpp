#include <iostream>
#include <string>

int main() {
    auto fz_n = (10 + 2);
    auto fz_i = 0;
    while ((fz_i < fz_n)) {
        auto fz_j = 0;
        while ((fz_j < fz_i)) {
            std::cout << "* ";
            fz_j = (fz_j + 1);
        }
        std::cout << " " << std::endl;
        fz_i = (fz_i + 1);
    }

    return 0;
}
